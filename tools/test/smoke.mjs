import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import pg from 'pg';

const port=33217;
const host='http://127.0.0.1:'+port;
const serverArgs=process.env.SMOKE_PRODUCTION==='1'
  ? ['dist/apps/api/src/server.js']
  : ['--import','tsx','apps/api/src/server.ts'];
const server=spawn(process.execPath,serverArgs,{
  env:{...process.env,API_PORT:String(port)},stdio:'inherit',
});
let exited=false;
server.once('exit',()=>{exited=true;});
async function waitForHealth(){
  for(let i=0;i<40;i++){
    if(exited)throw new Error('API exited before health check');
    try{const r=await fetch(host+'/health');if(r.ok)return;}catch{}
    await delay(400);
  }
  throw new Error('API did not become healthy');
}
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
await db.connect();
const origin=process.env.WEB_ORIGIN||'http://localhost:3000';
let cookieA='',cookieB='';
async function api(path,{method='GET',body,cookie=cookieA}={}){
  const r=await fetch(host+path,{
    method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),Origin:origin,
      ...(cookie?{Cookie:cookie}:{})},
    body:body===undefined?undefined:JSON.stringify(body),
  });
  let data;try{data=await r.json();}catch{data={};}
  return {status:r.status,data,cookie:r.headers.get('set-cookie')?.split(';')[0]||''};
}
try{
  await waitForHealth();
  const suffix=randomUUID().slice(0,8);
  const signup=await api('/auth/register',{method:'POST',cookie:'',body:{
    email:'first+'+suffix+'@example.com',password:'Passw0rd-Strong-123',displayName:'张工',
  }});
  assert.equal(signup.status,200,JSON.stringify(signup.data));
  cookieA=signup.cookie;assert.ok(cookieA);
  const uid=signup.data.user.id;
  const teams=await api('/tenants');
  assert.equal(teams.status,200);
  const tenantId=teams.data.tenants.find(t=>t.role==='admin')?.id;
  assert.ok(tenantId,'Registrant must own a team');
  const createInput={idempotencyKey:randomUUID(),
    name:'集成测试项目',tenantId,timezone:'Asia/Shanghai'};
  // Simultaneous duplicate HTTP requests must wait on the tenant receipt
  // unique key rather than generating independent projects/owner rows.
  const simultaneous=await Promise.all(Array.from({length:4},
    ()=>api('/projects',{method:'POST',body:createInput})));
  for(const answer of simultaneous)
    assert.equal(answer.status,201,JSON.stringify(answer.data));
  const created=simultaneous[0];
  const pid=created.data.project.id;
  assert.ok(simultaneous.every(answer=>answer.data.project.id===pid),
    'Concurrent identical commands must return exactly the same project ID');
  assert.equal(created.data.project.ai_enabled,false);
  assert.equal(created.data.project.owner_id,uid);
  const replayCreate=await api('/projects',{method:'POST',body:createInput});
  assert.equal(replayCreate.status,201);
  assert.equal(replayCreate.data.project.id,pid,'HTTP retry returns durable created project');
  const reusedProjectKey=await api('/projects',{method:'POST',body:{
    ...createInput,name:'Other project name'}});
  assert.equal(reusedProjectKey.status,409,'Same key with new name is not a new create');
  const missingProjectKey=await api('/projects',{method:'POST',body:{
    name:'No key',tenantId,timezone:'Asia/Shanghai'}});
  assert.equal(missingProjectKey.status,400,'Project creation requires UUID command key');
  const invalidProjectZone=await api('/projects',{method:'POST',body:{
    ...createInput,idempotencyKey:randomUUID(),timezone:'Fake/Invalid'}});
  assert.equal(invalidProjectZone.status,400);
  const projectsCount=(await db.query(`
    SELECT count(*)::int AS n FROM projects WHERE tenant_id=$1 AND name=$2
  `,[tenantId,createInput.name])).rows[0].n;
  assert.equal(projectsCount,1,'Concurrent retries must never duplicate projects');
  const ownerCount=(await db.query(`
    SELECT count(*)::int AS n FROM project_members WHERE project_id=$1 AND role='owner'
  `,[pid])).rows[0].n;
  assert.equal(ownerCount,1,'Creation must produce one owner');
  const rootReceipts=(await db.query(`
    SELECT project_id,result FROM tenant_command_receipts
    WHERE tenant_id=$1 AND actor_id=$2 AND kind='project.created.v1'
      AND idempotency_key=$3
  `,[tenantId,uid,createInput.idempotencyKey])).rows;
  assert.equal(rootReceipts.length,1,'One tenant receipt must deduplicate creation');
  assert.equal(rootReceipts[0].project_id,pid);
  assert.equal(rootReceipts[0].result.project.id,pid);
  const creationReceipts=(await db.query(`
    SELECT id,result FROM command_receipts WHERE project_id=$1
      AND actor_id=$2 AND kind='project.created.v1'
  `,[pid,uid])).rows;
  assert.equal(creationReceipts.length,1,'New project must carry its project-scoped receipt');
  assert.equal(creationReceipts[0].result.project.id,pid);
  const createdEvents=(await db.query(`
    SELECT id,aggregate_version,command_receipt_id FROM domain_events
    WHERE project_id=$1 AND kind='project.created.v1'
  `,[pid])).rows;
  assert.equal(createdEvents.length,1);
  assert.equal(createdEvents[0].command_receipt_id,creationReceipts[0].id);
  assert.equal(createdEvents[0].aggregate_version,1);
  const createOutbox=(await db.query(`
    SELECT count(*)::int AS n FROM outbox_events
    WHERE project_id=$1 AND kind='domain.changed'
      AND payload->>'domainEventId'=$2
  `,[pid,createdEvents[0].id])).rows[0].n;
  assert.equal(createOutbox,1,'Create event is delivered through transactional outbox');
  const createAudits=(await db.query(`
    SELECT count(*)::int AS n FROM audit_entries
    WHERE project_id=$1 AND action='project.created.v1'
  `,[pid])).rows[0].n;
  assert.equal(createAudits,1,'Concurrent duplicates cannot create extra audit rows');
  const listedInitial=await api('/projects');
  assert.equal(listedInitial.status,200);
  const initialProject=listedInitial.data.projects.find(p=>p.id===pid);
  assert.ok(initialProject,'New project must be returned in the project list');
  assert.equal(initialProject.work_start,null,'Unset work start must be explicit null');
  assert.equal(initialProject.work_end,null,'Unset work end must be explicit null');
  assert.equal(initialProject.cooldown_hours,null,'Unset cooldown must be explicit null');
  const initialAuthorization=await api('/projects/'+pid+'/ai/authorization');
  assert.equal(initialAuthorization.status,200,JSON.stringify(initialAuthorization.data));
  assert.deepEqual(initialAuthorization.data.authorization,{enabled:false,version:1});
  const initialInvocationList=await api('/projects/'+pid+'/ai/invocations');
  assert.equal(initialInvocationList.status,200);
  assert.deepEqual(initialInvocationList.data.invocations,[]);

  const suffix2=randomUUID().slice(0,8);
  const second=await api('/auth/register',{method:'POST',cookie:'',body:{
    email:'second+'+suffix2+'@example.com',password:'Passw0rd-Strong-123',displayName:'李工',
  }});
  assert.equal(second.status,200,JSON.stringify(second.data));
  cookieB=second.cookie;assert.ok(cookieB);
  const deniedLedger=await api('/projects/'+pid+'/ai/invocations',{cookie:cookieB});
  assert.equal(deniedLedger.status,404,'Cross-project invocation ledger must not leak');
  const forbidden=await api('/projects/'+pid+'/messages',{cookie:cookieB});
  assert.equal(forbidden.status,404,'Cross-project read must not be allowed');
  const denied=await api('/projects/'+pid+'/tasks',{method:'POST',cookie:cookieB,
    body:{idempotencyKey:randomUUID(),title:'越权任务',assigneeId:null,dueDate:null}});
  assert.equal(denied.status,404,'Cross-project write must not be allowed');
  const unauthorizedTenant=await api('/projects',{method:'POST',cookie:cookieB,body:{
    idempotencyKey:randomUUID(),name:'不能创建的项目',tenantId,
    timezone:'Asia/Shanghai'}});
  assert.equal(unauthorizedTenant.status,403,'Cannot create projects in another tenant');
  const addOrgMember=await api('/tenants/'+tenantId+'/members',{
    method:'POST',body:{email:'second+'+suffix2+'@example.com'}});
  assert.equal(addOrgMember.status,200,'Tenant administrator must enroll person first');
  const memberCannotCreate=await api('/projects',{method:'POST',cookie:cookieB,body:{
    idempotencyKey:randomUUID(),name:'Tenant member no-admin project',tenantId,
    timezone:'Asia/Shanghai'}});
  assert.equal(memberCannotCreate.status,403,
    'Tenant membership alone does not grant project creation');
  // Organization governance: route-level authorization, classification and audit.
  const forbiddenPortfolio=await api('/tenants/'+tenantId+'/portfolios',{
    method:'POST',cookie:cookieB,body:{name:'Forbidden Portfolio'}});
  assert.equal(forbiddenPortfolio.status,403,'Tenant members cannot manage portfolios');
  const dep=await api('/tenants/'+tenantId+'/departments',{
    method:'POST',body:{name:'Engineering '+suffix,parentId:null}});
  assert.equal(dep.status,201,JSON.stringify(dep.data));
  const portfolio=await api('/tenants/'+tenantId+'/portfolios',{
    method:'POST',body:{name:'Delivery '+suffix,description:'Portfolio for smoke'}});
  assert.equal(portfolio.status,201,JSON.stringify(portfolio.data));
  const program=await api('/tenants/'+tenantId+'/programs',{
    method:'POST',body:{name:'Integration '+suffix,description:'Program for smoke',
      portfolioId:portfolio.data.portfolio.id}});
  assert.equal(program.status,201,JSON.stringify(program.data));
  const classification=await api('/tenants/'+tenantId+'/projects/'+pid+'/classification',{
    method:'PATCH',body:{departmentId:dep.data.department.id,
      programId:program.data.program.id,portfolioId:null}});
  assert.equal(classification.status,200,JSON.stringify(classification.data));
  assert.equal(classification.data.project.program_id,program.data.program.id);
  const structure=await api('/tenants/'+tenantId+'/structure');
  assert.equal(structure.status,200,JSON.stringify(structure.data));
  assert.ok(structure.data.projects.some(p=>p.id===pid&&p.program_id===program.data.program.id));
  const assignDepartment=await api('/tenants/'+tenantId+'/departments/'+
    dep.data.department.id+'/members',{
    method:'POST',body:{userId:second.data.user.id,role:'member'}});
  assert.equal(assignDepartment.status,200,JSON.stringify(assignDepartment.data));
  const allocation=await api('/tenants/'+tenantId+'/allocations',{method:'POST',body:{
    projectId:pid,userId:uid,percentage:30,startDate:'2026-10-01',endDate:'2026-10-31'}});
  assert.equal(allocation.status,201,JSON.stringify(allocation.data));
  const auditRows=await db.query(
    'SELECT action FROM organization_audit_entries WHERE tenant_id=$1',[tenantId]);
  const audited=new Set(auditRows.rows.map(x=>x.action));
  for(const action of ['tenant.member_added','department.created','portfolio.created',
    'program.created','project.classification_changed','department.member_assigned',
    'allocation.recorded']){
    assert.ok(audited.has(action),'Missing organization audit: '+action);
  }

  const invitation={idempotencyKey:randomUUID(),email:'second+'+suffix2+'@example.com'};
  const invited=await api('/projects/'+pid+'/members',{method:'POST',body:invitation});
  assert.equal(invited.status,200,'Owner should be able to add a registered project member');
  const invitedReplay=await api('/projects/'+pid+'/members',{method:'POST',body:invitation});
  assert.equal(invitedReplay.status,200,'Same invitation must replay a receipt');
  const inviteKeyCollision=await api('/projects/'+pid+'/members',{method:'POST',
    body:{...invitation,email:'different@example.com'}});
  assert.equal(inviteKeyCollision.status,409,'Invitation key reuse with other email must fail');
  const duplicateInvitation=await api('/projects/'+pid+'/members',{method:'POST',
    body:{...invitation,idempotencyKey:randomUUID()}});
  assert.equal(duplicateInvitation.status,409,'New command must not claim an existing member');
  const memberCreatedEvents=(await db.query(`SELECT count(*)::int AS n
    FROM domain_events WHERE project_id=$1 AND aggregate_id=$2
      AND kind='project.member_added.v1'`,[pid,second.data.user.id])).rows[0].n;
  assert.equal(memberCreatedEvents,1,'Duplicate invitation cannot append domain events');
  const memberPath='/projects/'+pid+'/members/'+second.data.user.id;
  const managerCommand={idempotencyKey:randomUUID(),role:'manager'};
  const promoted=await api(memberPath,{method:'PATCH',body:managerCommand});
  assert.equal(promoted.status,200,'Owner may promote a member to manager');
  assert.equal((await api(memberPath,{method:'PATCH',body:managerCommand})).status,200,
    'Same role change replays its receipt');
  assert.equal((await api(memberPath,{method:'PATCH',body:{
    ...managerCommand,role:'observer'}})).status,409);
  assert.equal((await api(memberPath,{method:'PATCH',body:{
    idempotencyKey:randomUUID(),role:'manager'}})).status,409,
    'A second identical role change must not claim another event');
  const restored=await api(memberPath,{method:'PATCH',body:{
    idempotencyKey:randomUUID(),role:'member'}});
  assert.equal(restored.status,200,'Member can be restored before permission tests');
  const pm='/projects/'+pid+'/pm';

  const forbiddenGoal=await api(pm+'/goals',{method:'POST',cookie:cookieB,
    body:{idempotencyKey:randomUUID(),title:'No',successCriteria:'Not authorized'}});
  assert.equal(forbiddenGoal.status,403,'Project members cannot create goals');
  const goalInput={idempotencyKey:randomUUID(),title:'Release reliably',
    description:'Verify project value',successCriteria:'Accepted delivery'};
  const goal=await api(pm+'/goals',{method:'POST',body:goalInput});
  assert.equal(goal.status,201,JSON.stringify(goal.data));
  const goalId=goal.data.item.id;
  const sameGoal=await api(pm+'/goals',{method:'POST',body:goalInput});
  assert.equal(sameGoal.status,201);
  assert.equal(sameGoal.data.item.id,goalId,'Idempotent replay must not create a new goal');
  const keyReuse=await api(pm+'/goals',{method:'POST',body:{
    ...goalInput,title:'Different goal'}});
  assert.equal(keyReuse.status,409,'Different payload must not reuse a command key');
  const milestone=await api(pm+'/milestones',{method:'POST',body:{
    idempotencyKey:randomUUID(),title:'Sprint review',
    goalId,dueDate:'2026-12-31'}});
  assert.equal(milestone.status,201,JSON.stringify(milestone.data));
  const badMilestone=await api(pm+'/milestones',{method:'POST',body:{
    idempotencyKey:randomUUID(),title:'Cross project association',
    goalId:randomUUID(),dueDate:'2026-12-31'}});
  assert.notEqual(badMilestone.status,201,'Foreign goal must be rejected');
  const issue=await api(pm+'/issues',{method:'POST',body:{
    idempotencyKey:randomUUID(),title:'Environment not ready',
    detail:'Already blocking work',severity:'high',ownerId:uid}});
  assert.equal(issue.status,201,JSON.stringify(issue.data));
  const issueId=issue.data.item.id;
  const deniedIssueTransition=await api(pm+'/issues/'+issueId+'/transition',{
    method:'POST',cookie:cookieB,body:{idempotencyKey:randomUUID(),
      expectedVersion:1,decision:'resolve',note:'Already handled'}});
  assert.equal(deniedIssueTransition.status,403,'Members cannot resolve formal issues');
  const missingIssueNote=await api(pm+'/issues/'+issueId+'/transition',{
    method:'POST',body:{idempotencyKey:randomUUID(),
      expectedVersion:1,decision:'resolve',note:'   '}});
  assert.equal(missingIssueNote.status,400,'Issue transitions require evidence notes');
  const issueCommand={idempotencyKey:randomUUID(),expectedVersion:1,
    decision:'resolve',note:'Test environment was deployed and verified'};
  const issueResolved=await api(pm+'/issues/'+issueId+'/transition',{
    method:'POST',body:issueCommand});
  assert.equal(issueResolved.status,200,JSON.stringify(issueResolved.data));
  assert.equal(issueResolved.data.item.status,'resolved');
  assert.equal(issueResolved.data.item.version,2);
  const issueReplay=await api(pm+'/issues/'+issueId+'/transition',{
    method:'POST',body:issueCommand});
  assert.equal(issueReplay.status,200);
  assert.equal(issueReplay.data.item.version,2,'Idempotent replay must not increment the version');
  const changedIssuePayload=await api(pm+'/issues/'+issueId+'/transition',{
    method:'POST',body:{...issueCommand,note:'Other explanation'}});
  assert.equal(changedIssuePayload.status,409,'Reusing a key with a different note is invalid');
  const staleIssue=await api(pm+'/issues/'+issueId+'/transition',{
    method:'POST',body:{idempotencyKey:randomUUID(),
      expectedVersion:1,decision:'reopen',note:'Stale update'}});
  assert.equal(staleIssue.status,409,'Version conflict must be enforced');
  const resolvedAgain=await api(pm+'/issues/'+issueId+'/transition',{
    method:'POST',body:{idempotencyKey:randomUUID(),
      expectedVersion:2,decision:'resolve',note:'Duplicate resolution'}});
  assert.equal(resolvedAgain.status,409,'Resolved issues cannot resolve again');
  const memberHistory=await api(pm+'/issues/'+issueId+'/history',{cookie:cookieB});
  assert.equal(memberHistory.status,200);
  assert.equal(memberHistory.data.history.length,1);
  assert.equal(memberHistory.data.history[0].to_status,'resolved');
  assert.equal(memberHistory.data.history[0].note,issueCommand.note);
  const foreignIssueHistory=await api('/projects/'+randomUUID()+'/pm/issues/'+
    issueId+'/history');
  assert.equal(foreignIssueHistory.status,404,'Cross-project history must not leak');
  await db.query("UPDATE project_members SET role='manager' WHERE project_id=$1 AND user_id=$2",
    [pid,second.data.user.id]);
  const issueReopened=await api(pm+'/issues/'+issueId+'/transition',{
    method:'POST',cookie:cookieB,body:{idempotencyKey:randomUUID(),
      expectedVersion:2,decision:'reopen',note:'Environment failure returned'}});
  assert.equal(issueReopened.status,200,JSON.stringify(issueReopened.data));
  assert.equal(issueReopened.data.item.status,'open');
  assert.equal(issueReopened.data.item.version,3);
  await db.query("UPDATE project_members SET role='member' WHERE project_id=$1 AND user_id=$2",
    [pid,second.data.user.id]);
  const fullIssueHistory=await api(pm+'/issues/'+issueId+'/history');
  assert.equal(fullIssueHistory.status,200);
  assert.deepEqual(fullIssueHistory.data.history.map(x=>x.to_status),
    ['open','resolved']);
  assert.deepEqual(fullIssueHistory.data.history.map(x=>x.issue_version),[3,2]);
  assert.equal(fullIssueHistory.data.history[0].note,'Environment failure returned');
  const earlierIssueHistory=await api(pm+'/issues/'+issueId+'/history?beforeVersion=3');
  assert.equal(earlierIssueHistory.status,200);
  assert.deepEqual(earlierIssueHistory.data.history.map(x=>x.issue_version),[2]);
  assert.equal((await db.query(`SELECT count(*)::int AS count
    FROM project_issue_transitions WHERE project_id=$1 AND issue_id=$2`,
    [pid,issueId])).rows[0].count,2,'History must be append-only on state changes');
  assert.equal((await db.query(`SELECT count(*)::int AS count
    FROM domain_events WHERE project_id=$1 AND kind='pm.issue.transitioned.v1'
      AND aggregate_id=$2`,[pid,issueId])).rows[0].count,2);
  assert.equal((await db.query(`SELECT count(*)::int AS count
    FROM audit_entries WHERE project_id=$1 AND action='pm.issue.transitioned.v1'
      AND target_id=$2`,[pid,issueId])).rows[0].count,2);

  const decision=await api(pm+'/decisions',{method:'POST',body:{
    idempotencyKey:randomUUID(),title:'Use staged rollout',rationale:'Risk reduction'}});
  assert.equal(decision.status,201,JSON.stringify(decision.data));
  const deliverable=await api(pm+'/deliverables',{method:'POST',body:{
    idempotencyKey:randomUUID(),title:'Release checklist',
    acceptanceCriteria:'All checks pass',assigneeId:second.data.user.id,
    milestoneId:milestone.data.item.id,dueDate:'2026-12-20'}});
  assert.equal(deliverable.status,201,JSON.stringify(deliverable.data));
  const deliverableId=deliverable.data.item.id;
  const notAssigned=await api(pm+'/deliverables/'+deliverableId+'/submit',{
    method:'POST',body:{idempotencyKey:randomUUID(),expectedVersion:1}});
  assert.equal(notAssigned.status,403,'Only the assignee may submit');
  const submitted=await api(pm+'/deliverables/'+deliverableId+'/submit',{
    method:'POST',cookie:cookieB,
    body:{idempotencyKey:randomUUID(),expectedVersion:1}});
  assert.equal(submitted.status,200,JSON.stringify(submitted.data));
  assert.equal(submitted.data.item.status,'submitted');
  const rejectedReview=await api(pm+'/deliverables/'+deliverableId+'/review',{
    method:'POST',cookie:cookieB,
    body:{idempotencyKey:randomUUID(),expectedVersion:2,decision:'accept'}});
  assert.equal(rejectedReview.status,403,'Member must not approve deliverables');
  const conflictReview=await api(pm+'/deliverables/'+deliverableId+'/review',{
    method:'POST',
    body:{idempotencyKey:randomUUID(),expectedVersion:1,decision:'accept'}});
  assert.equal(conflictReview.status,409,'Stale review version must conflict');
  const pmAccepted=await api(pm+'/deliverables/'+deliverableId+'/review',{
    method:'POST',
    body:{idempotencyKey:randomUUID(),expectedVersion:2,decision:'accept'}});
  assert.equal(pmAccepted.status,200,JSON.stringify(pmAccepted.data));
  assert.equal(pmAccepted.data.item.status,'accepted');
  assert.equal(pmAccepted.data.item.version,3);
  const repeatSubmit=await api(pm+'/deliverables/'+deliverableId+'/submit',{
    method:'POST',cookie:cookieB,
    body:{idempotencyKey:randomUUID(),expectedVersion:3}});
  assert.equal(repeatSubmit.status,409);
  // Manager requests the baseline change. Owner must approve, not the author.
  await db.query("UPDATE project_members SET role='manager' WHERE project_id=$1 AND user_id=$2",
    [pid,second.data.user.id]);
  const change=await api(pm+'/changes',{method:'POST',cookie:cookieB,body:{
    idempotencyKey:randomUUID(),title:'Extend rollout',rationale:'Blocked integration',
    impact:'One day later'}});
  assert.equal(change.status,201,JSON.stringify(change.data));
  const selfApprove=await api(pm+'/changes/'+change.data.item.id+'/decide',{
    method:'POST',cookie:cookieB,
    body:{idempotencyKey:randomUUID(),expectedVersion:1,decision:'approve'}});
  assert.equal(selfApprove.status,403,'Only the project owner may approve baseline changes');
  const approved=await api(pm+'/changes/'+change.data.item.id+'/decide',{
    method:'POST',body:{idempotencyKey:randomUUID(),expectedVersion:1,
      decision:'approve'}});
  assert.equal(approved.status,200,JSON.stringify(approved.data));
  assert.equal(approved.data.item.status,'approved');
  const changeId=change.data.item.id;
  const workPath=pm+'/changes/'+changeId+'/implementation';
  const directComplete=await api(workPath,{method:'POST',body:{
    idempotencyKey:randomUUID(),expectedVersion:2,decision:'complete',
    evidenceMessageId:randomUUID(),note:'Cannot bypass implementation'}});
  assert.equal(directComplete.status,409,'An approved change is not implemented yet');
  const invalidImplementer=await api(workPath,{method:'POST',body:{
    idempotencyKey:randomUUID(),expectedVersion:2,decision:'start',
    ownerId:randomUUID(),note:'Missing assignee'}});
  assert.equal(invalidImplementer.status,400);
  const startInput={idempotencyKey:randomUUID(),expectedVersion:2,
    decision:'start',ownerId:second.data.user.id,note:'Begin verified implementation'};
  const startedChange=await api(workPath,{method:'POST',body:startInput});
  assert.equal(startedChange.status,200,JSON.stringify(startedChange.data));
  assert.equal(startedChange.data.item.status,'implementing');
  assert.equal(startedChange.data.item.version,3);
  assert.equal((await api(workPath,{method:'POST',body:startInput})).data.item.version,3,
    'Starting with the same key must replay its receipt');
  const observerWhileImplementing=await api(
    '/projects/'+pid+'/members/'+second.data.user.id,{
      method:'PATCH',body:{idempotencyKey:randomUUID(),role:'observer'}});
  assert.equal(observerWhileImplementing.status,409,
    'A project member responsible for implementation cannot become an observer');
  const earlyEvidence=await api('/projects/'+pid+'/messages',{method:'POST',
    cookie:cookieB,body:{nonce:randomUUID(),
      content:'先前开始的准备工作已完成，仍需等待正式重新分配。'}});
  assert.equal(earlyEvidence.status,201);
  const reassignA={idempotencyKey:randomUUID(),expectedVersion:3,
    decision:'reassign',ownerId:uid,note:'Hand back implementation ownership'};
  const assignedA=await api(workPath,{method:'POST',body:reassignA});
  assert.equal(assignedA.status,200,JSON.stringify(assignedA.data));
  assert.equal(assignedA.data.item.version,4);
  assert.equal(assignedA.data.item.implementation_owner_id,uid);
  assert.equal((await api(workPath,{method:'POST',body:reassignA})).data.item.version,4);
  const reassignB={idempotencyKey:randomUUID(),expectedVersion:4,
    decision:'reassign',ownerId:second.data.user.id,
    note:'Reassign to implementation owner with fresh evidence window'};
  const assignedB=await api(workPath,{method:'POST',body:reassignB});
  assert.equal(assignedB.status,200,JSON.stringify(assignedB.data));
  assert.equal(assignedB.data.item.version,5);
  assert.equal(assignedB.data.item.implementation_owner_id,second.data.user.id);
  const authorWrong=await api('/projects/'+pid+'/messages',{method:'POST',
    body:{nonce:randomUUID(),content:'审批人自己留下的消息不能冒充实施负责人证据。'}});
  assert.equal(authorWrong.status,201);
  const actualEvidence=await api('/projects/'+pid+'/messages',{method:'POST',
    cookie:cookieB,body:{nonce:randomUUID(),
      content:'联调与延期范围已按批准计划实施，附验证环境记录。'}});
  assert.equal(actualEvidence.status,201);
  const memberSelfVerify=await api(workPath,{method:'POST',cookie:cookieB,body:{
    idempotencyKey:randomUUID(),expectedVersion:5,decision:'complete',
    evidenceMessageId:actualEvidence.data.message.id,note:'Self review'}});
  assert.equal(memberSelfVerify.status,403,
    'An implementer cannot approve their own completion claim');
  const staleProof=await api(workPath,{method:'POST',body:{
    idempotencyKey:randomUUID(),expectedVersion:5,decision:'complete',
    evidenceMessageId:earlyEvidence.data.message.id,
    note:'Old evidence before reassignment is invalid'}});
  assert.equal(staleProof.status,409,'Reassignment resets the evidence clock');
  const wrongAuthor=await api(workPath,{method:'POST',body:{
    idempotencyKey:randomUUID(),expectedVersion:5,decision:'complete',
    evidenceMessageId:authorWrong.data.message.id,note:'Cannot verify wrong author'}});
  assert.equal(wrongAuthor.status,409);
  const verifyInput={idempotencyKey:randomUUID(),expectedVersion:5,
    decision:'complete',evidenceMessageId:actualEvidence.data.message.id,
    note:'Independent owner reviewed the actual implementation message'};
  const implemented=await api(workPath,{method:'POST',body:verifyInput});
  assert.equal(implemented.status,200,JSON.stringify(implemented.data));
  assert.equal(implemented.data.item.status,'implemented');
  assert.equal(implemented.data.item.version,6);
  assert.equal(implemented.data.item.implemented_by,uid);
  assert.equal(implemented.data.item.implementation_evidence_message_id,
    actualEvidence.data.message.id);
  const replayImplemented=await api(workPath,{method:'POST',body:verifyInput});
  assert.equal(replayImplemented.status,200);
  assert.equal(replayImplemented.data.item.version,6);
  const versionConflict=await api(workPath,{method:'POST',body:{
    ...verifyInput,idempotencyKey:randomUUID()}});
  assert.equal(versionConflict.status,409,'New command cannot reuse old version');
  const changeHistory=await api(workPath+'/history',{cookie:cookieB});
  assert.equal(changeHistory.status,200);
  assert.deepEqual(changeHistory.data.history.map(x=>x.change_version),[6,5,4,3]);
  assert.deepEqual(changeHistory.data.history.map(x=>x.action),
    ['complete','reassign','reassign','start']);
  const foreignHistory=await api('/projects/'+randomUUID()+
    '/pm/changes/'+changeId+'/implementation/history');
  assert.equal(foreignHistory.status,404);
  const implementationEvents=(await db.query(`
    SELECT kind,aggregate_version AS version FROM domain_events
    WHERE project_id=$1 AND aggregate_id=$2
      AND kind IN ('pm.change.implementation_started.v1',
        'pm.change.implementation_reassigned.v1','pm.change.implemented.v1')
    ORDER BY aggregate_version`,[pid,changeId])).rows;
  assert.deepEqual(implementationEvents.map(x=>x.version),[3,4,5,6]);
  assert.equal(implementationEvents.length,4,
    'Replayed implementation commands cannot double-emit events');
  await db.query("UPDATE project_members SET role='member' WHERE project_id=$1 AND user_id=$2",
    [pid,second.data.user.id]);
  const register=await api(pm);
  assert.equal(register.status,200);
  assert.equal(register.data.goals.find(x=>x.id===goalId).success_criteria,
    'Accepted delivery');
  assert.equal(register.data.deliverables.find(x=>x.id===deliverableId).status,'accepted');
  assert.equal((await api(pm,{cookie:cookieB})).status,200);
  const receiptCount=(await db.query(`SELECT count(*)::int AS count
    FROM command_receipts WHERE project_id=$1 AND kind='pm.goals.created.v1'`,
  [pid])).rows[0].count;
  assert.equal(receiptCount,1,'Idempotent command must create exactly one receipt');
  const eventCount=(await db.query(`SELECT count(*)::int AS count
    FROM domain_events WHERE project_id=$1`,[pid])).rows[0].count;
  assert.ok(eventCount>=9,'PM operations must create traceable domain events');

  const memberView=await api('/projects/'+pid+'/members',{cookie:cookieB});
  assert.equal(memberView.status,200);
  const ownerOnly=await api('/projects/'+pid+'/settings',{method:'PATCH',cookie:cookieB,
    body:{idempotencyKey:randomUUID(),expectedRevision:1,
      aiEnabled:false,workStart:9,workEnd:18,cooldownHours:24}});
  assert.equal(ownerOnly.status,403,'Project members cannot change AI or reminder policy');
  const deniedModel=await api('/admin/ai/models');
  assert.equal(deniedModel.status,403,'Tenant owner is not a platform system administrator');
  const memberModel=await api('/admin/ai/models',{cookie:cookieB});
  assert.equal(memberModel.status,403,'Regular members cannot read global AI model registry');
  await db.query('UPDATE users SET is_system_admin=TRUE WHERE id=$1',[uid]);
  const provider=await api('/admin/ai/providers',{method:'POST',body:{
    name:'Smoke provider',baseUrl:'https://api.openai.com/v1',style:'responses',
    enabled:true,apiKey:'smoke-private-test-key',
  }});
  assert.equal(provider.status,201,JSON.stringify(provider.data));
  assert.equal(provider.data.provider.hasKey,true);
  assert.ok(!JSON.stringify(provider.data).includes('smoke-private-test-key'));
  const adminModel=await api('/admin/ai/models',{method:'POST',body:{
    name:'Smoke default model',model:'mock-model',providerId:provider.data.provider.id,
    reasoning:'auto',reasoningFormat:'none',maxOutputTokens:8192,contextChars:32768,
    enabled:true,isDefault:true,
  }});
  assert.equal(adminModel.status,201,JSON.stringify(adminModel.data));
  assert.equal(adminModel.data.model.isDefault,true);
  const providerModels=await api('/admin/ai/models');
  assert.equal(providerModels.status,200);
  assert.equal(providerModels.data.models[0].providerId,provider.data.provider.id);
  const secondModel=await api('/admin/ai/models',{method:'POST',body:{
    name:'Smoke alternative',model:'mock-secondary',providerId:provider.data.provider.id,
    reasoning:'auto',reasoningFormat:'none',maxOutputTokens:8192,contextChars:32768,
    enabled:false,isDefault:false,
  }});
  assert.equal(secondModel.status,201,'A provider must support multiple models');
  // Discovery and batch import: a local fixture proves that no real vendor
  // service or production project content is required for acceptance.
  const catalogServer=createServer((req,res)=>{
    assert.equal(req.headers.authorization,'Bearer smoke-catalog-secret');
    res.setHeader('Content-Type','application/json');
    if(req.method==='GET'&&req.url==='/v1/models'){
      res.end(JSON.stringify({data:[
        {id:'smoke-discovered-a',name:'Same display label'},
        {id:'smoke-discovered-b',name:'Same display label'},
      ]}));return;
    }
    if(req.method==='POST'&&req.url==='/v1/chat/completions'){
      res.end(JSON.stringify({choices:[{
        finish_reason:'stop',message:{content:'{"ok":true}'},
      }]}));return;
    }
    res.statusCode=404;res.end('{}');
  });
  await new Promise(resolve=>catalogServer.listen(0,'127.0.0.1',resolve));
  try{
    const localPort=catalogServer.address().port;
    const local=await api('/admin/ai/providers',{method:'POST',body:{
      name:'Catalog smoke '+suffix,baseUrl:'http://127.0.0.1:'+localPort+'/v1',
      style:'chat-completions',enabled:false,apiKey:'smoke-catalog-secret',
    }});
    assert.equal(local.status,201,JSON.stringify(local.data));
    const connectionId=local.data.provider.id;
    const deniedCatalog=await api('/admin/ai/providers/'+connectionId+'/discover',{
      method:'POST',cookie:cookieB});
    assert.equal(deniedCatalog.status,403);
    const discovered=await api('/admin/ai/providers/'+connectionId+'/discover',{method:'POST'});
    assert.equal(discovered.status,200,JSON.stringify(discovered.data));
    assert.deepEqual(discovered.data.models.map(m=>m.id),
      ['smoke-discovered-a','smoke-discovered-b']);
    assert.ok(!JSON.stringify(discovered.data).includes('smoke-catalog-secret'));
    const repeated=await api('/admin/ai/providers/'+connectionId+'/discover',{method:'POST'});
    assert.equal(repeated.status,200,'Catalog must refresh again immediately');
    assert.deepEqual(repeated.data.models,discovered.data.models);
    const selection={providerId:connectionId,models:discovered.data.models.map(
      ({id,name})=>({id,name}))};
    const deniedImport=await api('/admin/ai/models/import',{
      method:'POST',cookie:cookieB,body:selection});
    assert.equal(deniedImport.status,403);
    const imported=await api('/admin/ai/models/import',{method:'POST',body:selection});
    assert.equal(imported.status,201,JSON.stringify(imported.data));
    assert.equal(imported.data.created,2,'Same display labels should not break batch import');
    const again=await api('/admin/ai/models/import',{method:'POST',body:selection});
    assert.equal(again.status,201);
    assert.equal(again.data.created,0);
    assert.equal(again.data.skipped,2,'Reimport must be idempotent');
    const importedList=await api('/admin/ai/models');
    const found=importedList.data.models.filter(m=>m.providerId===connectionId);
    assert.equal(found.length,2);
    assert.ok(found.every(m=>!m.enabled&&!m.isDefault));
    assert.equal(new Set(found.map(m=>m.name)).size,2);
    const testedInactive=await api('/admin/ai/models/'+found[0].id+'/test',{
      method:'POST',body:{mode:'quick'}});
    assert.equal(testedInactive.status,200,JSON.stringify(testedInactive.data));
    assert.equal(testedInactive.data.ok,true,
      'Disabled provider and model must be testable before production enablement');
    assert.equal(testedInactive.data.mode,'quick');
    assert.equal(testedInactive.data.textOk,null,'Quick test skips a second text request');
    assert.equal(testedInactive.data.structuredOk,true);
    const full=await api('/admin/ai/models/'+found[1].id+'/test',{
      method:'POST',body:{mode:'full'}});
    assert.equal(full.status,200,JSON.stringify(full.data));
    assert.equal(full.data.mode,'full');
    assert.equal(full.data.textOk,true);
    assert.equal(full.data.structuredOk,true);
  }finally{await new Promise(resolve=>catalogServer.close(resolve));}
  const deniedConnection=await api('/admin/ai/providers',{cookie:cookieB});
  assert.equal(deniedConnection.status,403,'Non-administrators cannot read provider configuration');
  const forbidWrite=await api('/admin/ai/models',{method:'POST',cookie:cookieB,
    body:{name:'denied'}});
  assert.equal(forbidWrite.status,403);
  const adminListing=await api('/admin/ai/models');
  assert.equal(adminListing.status,200);
  const before=await api('/projects/'+pid+'/messages');
  assert.equal(before.status,200);
  const nonce=randomUUID();
  const body={content:'接口周三计划交付。',nonce};
  const posted=await api('/projects/'+pid+'/messages',{method:'POST',body});
  assert.equal(posted.status,201,JSON.stringify(posted.data));
  const duplicate=await api('/projects/'+pid+'/messages',{method:'POST',body});
  assert.equal(duplicate.status,201);
  assert.equal(posted.data.message.id,duplicate.data.message.id,'Message retry must be idempotent');
  const messages=await api('/projects/'+pid+'/messages');
  assert.equal(messages.data.messages.filter(m=>m.client_nonce===nonce).length,1,
    'Original message deduplication remains correct alongside change evidence messages');
  const secondProject=await api('/projects',{method:'POST',body:{
    idempotencyKey:randomUUID(),
    name:'外键隔离测试项目',tenantId,timezone:'Asia/Shanghai'}});
  assert.equal(secondProject.status,201);
  await assert.rejects(
    db.query(`INSERT INTO proposed_changes(project_id,source_message_id,kind,title)
      VALUES($1,$2,'task','跨项目非法证据')`,
      [secondProject.data.project.id,posted.data.message.id]),
    (err)=>err.code==='23503',
    'Database must reject source messages from another project',
  );
  // Holding the project message lock simulates a message transaction that commits late.
  // A later request must not allocate/commit a higher cursor before this one commits.
  await db.query('BEGIN');
  let unlocked=false;
  try{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1::text, 0))',
      ['chatpm:messages:'+pid]);
    const earlier=(await db.query(
      `INSERT INTO messages(project_id,author_id,kind,content,client_nonce)
       VALUES($1,$2,'user','先开始的事务',$3) RETURNING seq`,
      [pid,uid,randomUUID()])).rows[0];
    const pending=api('/projects/'+pid+'/messages',{method:'POST',
      body:{content:'后开始的事务',nonce:randomUUID()}});
    const completedBeforeCommit=await Promise.race([
      pending.then(()=>true),delay(200).then(()=>false),
    ]);
    assert.equal(completedBeforeCommit,false,'Concurrent message must wait for earlier commit');
    await db.query('COMMIT');
    unlocked=true;
    const later=await pending;
    assert.equal(later.status,201,JSON.stringify(later.data));
    assert.ok(BigInt(later.data.message.seq)>BigInt(earlier.seq));
    const delta=await api('/projects/'+pid+'/messages?after='+earlier.seq);
    assert.ok(delta.data.messages.some(m=>m.id===later.data.message.id),
      'Incremental cursor must never skip a late-committing message');
  }finally{
    if(!unlocked)await db.query('ROLLBACK');
  }
  const directTaskInput={idempotencyKey:randomUUID(),
    title:'正式任务',detail:'',assigneeId:uid,dueDate:null};
  const task=await api('/projects/'+pid+'/tasks',{method:'POST',body:directTaskInput});
  assert.equal(task.status,201,JSON.stringify(task.data));
  const taskReplay=await api('/projects/'+pid+'/tasks',{method:'POST',body:directTaskInput});
  assert.equal(taskReplay.status,201,'Replayed task creation must return the existing receipt');
  assert.equal(taskReplay.data.task.id,task.data.task.id);
  const taskKeyConflict=await api('/projects/'+pid+'/tasks',{method:'POST',
    body:{...directTaskInput,title:'Different task'}});
  assert.equal(taskKeyConflict.status,409,'Reused key with different input is rejected');
  const missingTaskKey=await api('/projects/'+pid+'/tasks',{method:'POST',
    body:{title:'Unkeyed task',assigneeId:null,dueDate:null}});
  assert.equal(missingTaskKey.status,400,'Task writes require idempotency keys');
  const taskCreatedEvents=(await db.query(`SELECT count(*)::int AS n FROM domain_events
    WHERE project_id=$1 AND kind='task.created.v1' AND aggregate_id=$2`,
    [pid,task.data.task.id])).rows[0].n;
  assert.equal(taskCreatedEvents,1,'Duplicate creation must not emit two events');
  // Sourced project claims: an author confirms a statement, never task acceptance.
  const evidenceBase='/projects/'+pid+'/evidence/claims';
  const ownerEvidenceText='🧩 我计划本周五完成环境配置，仍需验收。';
  const ownerEvidencePost=await api('/projects/'+pid+'/messages',{method:'POST',body:{
    content:ownerEvidenceText,nonce:randomUUID()}});
  assert.equal(ownerEvidencePost.status,201,JSON.stringify(ownerEvidencePost.data));
  const ownerEvidenceId=ownerEvidencePost.data.message.id;
  const ownerClaimInput={idempotencyKey:randomUUID(),messageId:ownerEvidenceId,
    startCp:0,endCp:Array.from(ownerEvidenceText).length,kind:'commitment',
    summary:'来源作者计划完成环境配置，尚未正式验收'};
  const ownerClaim=await api(evidenceBase,{method:'POST',body:ownerClaimInput});
  assert.equal(ownerClaim.status,201,JSON.stringify(ownerClaim.data));
  assert.equal(ownerClaim.data.evidence.quote,ownerEvidenceText);
  const ownerClaimId=ownerClaim.data.claim.id;
  const sameClaim=await api(evidenceBase,{method:'POST',body:ownerClaimInput});
  assert.equal(sameClaim.status,201);
  assert.equal(sameClaim.data.claim.id,ownerClaimId,'Same command must replay its receipt');
  const conflictClaim=await api(evidenceBase,{method:'POST',body:{
    ...ownerClaimInput,summary:'A different explanation'}});
  assert.equal(conflictClaim.status,409,'Key reuse with changed explanation is invalid');
  const shortEvidence=await api(evidenceBase,{method:'POST',body:{
    ...ownerClaimInput,idempotencyKey:randomUUID(),startCp:999,endCp:1000}});
  assert.equal(shortEvidence.status,400,'Out-of-range evidence offsets must be rejected');
  const absentEvidence=await api(evidenceBase,{method:'POST',body:{
    ...ownerClaimInput,idempotencyKey:randomUUID(),messageId:randomUUID()}});
  assert.equal(absentEvidence.status,404,'Only same-project messages are citable');
  const memberCannotCiteOwner=await api(evidenceBase,{method:'POST',cookie:cookieB,
    body:{...ownerClaimInput,idempotencyKey:randomUUID()}});
  assert.equal(memberCannotCiteOwner.status,403,'Members only cite their own messages');
  const memberCannotAcknowledgeOwner=await api(evidenceBase+'/'+ownerClaimId+'/review',{
    method:'POST',cookie:cookieB,body:{idempotencyKey:randomUUID(),
      expectedVersion:1,decision:'acknowledge'}});
  assert.equal(memberCannotAcknowledgeOwner.status,403);
  const ownerAcknowledgmentInput={idempotencyKey:randomUUID(),
    expectedVersion:1,decision:'acknowledge'};
  const ownerAcknowledgment=await api(evidenceBase+'/'+ownerClaimId+'/review',{
    method:'POST',body:ownerAcknowledgmentInput});
  assert.equal(ownerAcknowledgment.status,200,JSON.stringify(ownerAcknowledgment.data));
  assert.equal(ownerAcknowledgment.data.claim.status,'source_acknowledged');
  const acknowledgmentReplay=await api(evidenceBase+'/'+ownerClaimId+'/review',{
    method:'POST',body:ownerAcknowledgmentInput});
  assert.equal(acknowledgmentReplay.status,200);
  assert.equal(acknowledgmentReplay.data.claim.version,2);
  const repeatedAcknowledgment=await api(evidenceBase+'/'+ownerClaimId+'/review',{
    method:'POST',body:{idempotencyKey:randomUUID(),
      expectedVersion:2,decision:'acknowledge'}});
  assert.equal(repeatedAcknowledgment.status,409);
  const memberEvidenceText='联调方案已经完成初稿，尚未验收。';
  const memberEvidencePost=await api('/projects/'+pid+'/messages',{
    method:'POST',cookie:cookieB,body:{content:memberEvidenceText,nonce:randomUUID()}});
  assert.equal(memberEvidencePost.status,201,JSON.stringify(memberEvidencePost.data));
  const memberEvidenceId=memberEvidencePost.data.message.id;
  const memberClaimInput={idempotencyKey:randomUUID(),messageId:memberEvidenceId,
    startCp:0,endCp:Array.from(memberEvidenceText).length,kind:'completion_claim',
    summary:'成员声明完成初稿，并未经过验收'};
  const memberClaim=await api(evidenceBase,{method:'POST',cookie:cookieB,
    body:memberClaimInput});
  assert.equal(memberClaim.status,201,JSON.stringify(memberClaim.data));
  const memberClaimId=memberClaim.data.claim.id;
  const ownerCannotAcknowledgeMember=await api(evidenceBase+'/'+memberClaimId+'/review',{
    method:'POST',body:{idempotencyKey:randomUUID(),
      expectedVersion:1,decision:'acknowledge'}});
  assert.equal(ownerCannotAcknowledgeMember.status,403);
  const memberCannotDismiss=await api(evidenceBase+'/'+memberClaimId+'/review',{
    method:'POST',cookie:cookieB,body:{idempotencyKey:randomUUID(),
      expectedVersion:1,decision:'dismiss'}});
  assert.equal(memberCannotDismiss.status,403);
  const ownerDismissed=await api(evidenceBase+'/'+memberClaimId+'/review',{
    method:'POST',body:{idempotencyKey:randomUUID(),
      expectedVersion:1,decision:'dismiss'}});
  assert.equal(ownerDismissed.status,200,JSON.stringify(ownerDismissed.data));
  assert.equal(ownerDismissed.data.claim.status,'dismissed');
  const evidenceList=await api(evidenceBase,{cookie:cookieB});
  assert.equal(evidenceList.status,200);
  assert.ok(evidenceList.data.claims.some(x=>x.id===ownerClaimId));
  assert.ok(evidenceList.data.claims.some(x=>x.id===memberClaimId));
  const unknownProjectClaims=await api('/projects/'+randomUUID()+'/evidence/claims');
  assert.equal(unknownProjectClaims.status,404);
  const evidenceAudit=(await db.query(`SELECT count(*)::int AS n FROM audit_entries
    WHERE project_id=$1 AND action IN ('evidence.claim.created.v1',
      'evidence.claim.reviewed.v1')`,[pid])).rows[0].n;
  assert.equal(evidenceAudit,4,'Two claims and two reviews require four audit entries');
  const evidenceEvents=(await db.query(`SELECT count(*)::int AS n FROM domain_events
    WHERE project_id=$1 AND kind IN ('evidence.claim.created.v1',
      'evidence.claim.reviewed.v1')`,[pid])).rows[0].n;
  assert.equal(evidenceEvents,4,'Formal evidence commands must persist domain events');
  const evidenceRows=(await db.query(`SELECT count(*)::int AS n FROM project_evidence_spans
    WHERE project_id=$1`,[pid])).rows[0].n;
  assert.equal(evidenceRows,2,'Failed or replayed attempts must not create extra spans');

  const tid=task.data.task.id;
  const anotherTask=await api('/projects/'+pid+'/tasks',{method:'POST',body:{idempotencyKey:randomUUID(),
    title:'Dependency predecessor',detail:'',assigneeId:uid,dueDate:null}});
  assert.equal(anotherTask.status,201,JSON.stringify(anotherTask.data));
  const prerequisiteTaskId=anotherTask.data.task.id;
  const dependency=await api(pm+'/dependencies',{method:'POST',body:{
    idempotencyKey:randomUUID(),dependentTaskId:tid,prerequisiteTaskId}});
  assert.equal(dependency.status,201,JSON.stringify(dependency.data));
  const cyclic=await api(pm+'/dependencies',{method:'POST',body:{
    idempotencyKey:randomUUID(),dependentTaskId:prerequisiteTaskId,
    prerequisiteTaskId:tid}});
  assert.equal(cyclic.status,409,'Cyclic dependencies must not be accepted');
  const noDependency=await api(pm+'/dependencies',{method:'POST',body:{
    idempotencyKey:randomUUID(),dependentTaskId:tid,prerequisiteTaskId:randomUUID()}});
  assert.equal(noDependency.status,404,'Dependencies must reference same-project tasks');
  const dependencies=await api(pm+'/dependencies');
  assert.equal(dependencies.status,200);
  assert.equal(dependencies.data.dependencies.filter(x=>x.dependent_task_id===tid).length,1);
  const prematureCompletion=await api('/projects/'+pid+'/tasks/'+tid,{
    method:'PATCH',body:{idempotencyKey:randomUUID(),status:'done',version:1}});
  assert.equal(prematureCompletion.status,409,
    'A dependent task cannot complete before its predecessor');
  const unmodified=(await db.query('SELECT status,version FROM tasks WHERE id=$1',[tid])).rows[0];
  assert.equal(unmodified.status,'todo');
  assert.equal(unmodified.version,1,'Blocked completion must roll back');
  const completedStandalone=await api('/projects/'+pid+'/tasks',{method:'POST',body:{idempotencyKey:randomUUID(),
    title:'Already delivered separate work',detail:'',assigneeId:uid,dueDate:null}});
  assert.equal(completedStandalone.status,201,JSON.stringify(completedStandalone.data));
  const completedStandaloneId=completedStandalone.data.task.id;
  const standaloneDone=await api('/projects/'+pid+'/tasks/'+completedStandaloneId,{
    method:'PATCH',body:{idempotencyKey:randomUUID(),status:'done',version:1}});
  assert.equal(standaloneDone.status,200,'Tasks without prerequisites can finish');
  const impossibleLateDependency=await api(pm+'/dependencies',{
    method:'POST',body:{idempotencyKey:randomUUID(),
      dependentTaskId:completedStandaloneId,prerequisiteTaskId:tid}});
  assert.equal(impossibleLateDependency.status,409,
    'Cannot add an unfinished prerequisite to already finished work');
  const prerequisiteDone=await api('/projects/'+pid+'/tasks/'+prerequisiteTaskId,{
    method:'PATCH',body:{idempotencyKey:randomUUID(),status:'done',version:1}});
  assert.equal(prerequisiteDone.status,200,'Predecessor completion is permitted');


  const progressSource=await api('/projects/'+pid+'/messages',{method:'POST',
    body:{content:'方案初稿已完成，请核对评审',nonce:randomUUID()}});
  assert.equal(progressSource.status,201);
  const taskForProgress=(await db.query('SELECT id FROM tasks WHERE project_id=$1 LIMIT 1',[pid])).rows[0];
  assert.ok(taskForProgress);
  const progressInsert=(await db.query(`INSERT INTO task_progress_updates(
    project_id,task_id,source_message_id,summary,kind,model_name,prompt_version)
    VALUES($1,$2,$3,'方案初稿完成','progress','mock','p1') RETURNING id`,
    [pid,taskForProgress.id,progressSource.data.message.id])).rows[0];
  const progressMember=await api('/projects/'+pid+'/progress',{cookie:cookieB});
  assert.equal(progressMember.status,200);
  assert.ok(progressMember.data.updates.some(x=>x.id===progressInsert.id));
  const progressForbidden=await api('/projects/'+pid+'/progress/'+progressInsert.id+'/decision',{
    method:'POST',cookie:cookieB,body:{idempotencyKey:randomUUID(),decision:'accepted'}});
  assert.equal(progressForbidden.status,403);
  const progressDecision={idempotencyKey:randomUUID(),decision:'accepted'};
  const progressAccepted=await api('/projects/'+pid+'/progress/'+progressInsert.id+'/decision',{
    method:'POST',body:progressDecision});
  assert.equal(progressAccepted.status,200);
  const progressReplay=await api('/projects/'+pid+'/progress/'+progressInsert.id+'/decision',{
    method:'POST',body:progressDecision});
  assert.equal(progressReplay.status,200,'Same progress command is idempotent');
  const progressKeyConflict=await api('/projects/'+pid+'/progress/'+progressInsert.id+'/decision',{
    method:'POST',body:{...progressDecision,decision:'rejected'}});
  assert.equal(progressKeyConflict.status,409);
  const progressAgain=await api('/projects/'+pid+'/progress/'+progressInsert.id+'/decision',{
    method:'POST',body:{idempotencyKey:randomUUID(),decision:'accepted'}});
  assert.equal(progressAgain.status,409);
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM domain_events
    WHERE project_id=$1 AND aggregate_id=$2 AND kind='task.progress.reviewed.v1'`,
    [pid,progressInsert.id])).rows[0].n,1);

  const taskUpdateInput={idempotencyKey:randomUUID(),status:'doing',version:1};
  const changed=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',body:taskUpdateInput});
  assert.equal(changed.status,200);
  const taskUpdateReplay=await api('/projects/'+pid+'/tasks/'+tid,{
    method:'PATCH',body:taskUpdateInput});
  assert.equal(taskUpdateReplay.status,200);
  assert.equal(taskUpdateReplay.data.task.version,changed.data.task.version);
  const taskUpdateKeyConflict=await api('/projects/'+pid+'/tasks/'+tid,{
    method:'PATCH',body:{...taskUpdateInput,status:'blocked'}});
  assert.equal(taskUpdateKeyConflict.status,409);
  const taskUpdatedEvents=(await db.query(`SELECT count(*)::int AS n FROM domain_events
    WHERE project_id=$1 AND kind='task.updated.v1' AND aggregate_id=$2`,
    [pid,tid])).rows[0].n;
  assert.equal(taskUpdatedEvents,1,'Task status update must write one event');
  const stale=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',
    body:{idempotencyKey:randomUUID(),status:'done',version:1}});
  assert.equal(stale.status,409,'Stale versions must not overwrite task state');
  const edited=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',body:{idempotencyKey:randomUUID(),
    version:2,assigneeId:uid,dueDate:new Date(Date.now()+86400000).toISOString().slice(0,10),
  }});
  assert.equal(edited.status,200,'Owner may edit task plan');
  const settingsCommand={idempotencyKey:randomUUID(),expectedRevision:1,
    aiEnabled:false,workStart:9,workEnd:18,cooldownHours:24};
  const configured=await api('/projects/'+pid+'/settings',{
    method:'PATCH',body:settingsCommand});
  assert.equal(configured.status,200);
  assert.equal(configured.data.settingsRevision,2);
  const configurationReplay=await api('/projects/'+pid+'/settings',{
    method:'PATCH',body:settingsCommand});
  assert.equal(configurationReplay.status,200);
  assert.equal(configurationReplay.data.settingsRevision,2);
  const settingsConflict=await api('/projects/'+pid+'/settings',{
    method:'PATCH',body:{...settingsCommand,workStart:10}});
  assert.equal(settingsConflict.status,409,'Same key cannot hide altered project settings');
  const staleSettings=await api('/projects/'+pid+'/settings',{
    method:'PATCH',body:{...settingsCommand,idempotencyKey:randomUUID()}});
  assert.equal(staleSettings.status,409,'Stale project settings revision must fail');
  const unkeyedSettings=await api('/projects/'+pid+'/settings',{method:'PATCH',
    body:{aiEnabled:false,workStart:9,workEnd:18,cooldownHours:24}});
  assert.equal(unkeyedSettings.status,400);
  const listedConfigured=await api('/projects');
  assert.equal(listedConfigured.status,200);
  const configuredProject=listedConfigured.data.projects.find(p=>p.id===pid);
  assert.equal(configuredProject.work_start,9);
  assert.equal(configuredProject.work_end,18);
  assert.equal(configuredProject.cooldown_hours,24);
  assert.equal(configuredProject.settings_revision,2,'Settings revision must be listed');
  const settingsEvents=(await db.query(`SELECT count(*)::int AS n
    FROM domain_events WHERE project_id=$1 AND aggregate_id=$2
      AND kind='project.settings_changed.v1'`,[pid,pid])).rows[0].n;
  assert.equal(settingsEvents,1,'Stale settings writes must not emit extra events');
  const followup=await db.query(
    'SELECT active FROM followup_plans WHERE task_id=$1',[tid]);
  assert.equal(followup.rows[0]?.active,true,'Task follow-up must be durable');
  await db.query(
    "UPDATE followup_plans SET last_sent_at=NOW(),next_at=NOW()+INTERVAL '24 hours' WHERE task_id=$1",
    [tid]);
  const replanned=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',
    body:{idempotencyKey:randomUUID(),version:edited.data.task.version,
      dueDate:new Date(Date.now()+3*86400000).toISOString().slice(0,10)}});
  assert.equal(replanned.status,200,'Replanning should succeed');
  const cooldown=await db.query(
    "SELECT next_at >= last_sent_at + INTERVAL '24 hours' AS preserved FROM followup_plans WHERE task_id=$1",
    [tid]);
  assert.equal(cooldown.rows[0]?.preserved,true,'Replanning must preserve last reminder cooldown');
  const finallyCompleted=await api('/projects/'+pid+'/tasks/'+tid,{
    method:'PATCH',body:{idempotencyKey:randomUUID(),status:'done',version:replanned.data.task.version}});
  assert.equal(finallyCompleted.status,200,
    'Dependent task may finish after the prerequisite is completed');
  assert.equal(finallyCompleted.data.task.status,'done');
  const validAfterCompletion=await api(pm+'/dependencies',{
    method:'POST',body:{idempotencyKey:randomUUID(),
      dependentTaskId:completedStandaloneId,prerequisiteTaskId:tid}});
  assert.equal(validAfterCompletion.status,201,
    'Adding an already-satisfied dependency does not contradict completed work');


  const candidate=(await db.query(
    `INSERT INTO proposed_changes(project_id,source_message_id,kind,title,detail)
     VALUES($1,$2,'task',$3,'请核对') RETURNING id`,
    [pid,posted.data.message.id,'来自聊天的候选任务'])).rows[0];
  const memberDenied=await api('/projects/'+pid+'/proposals/'+candidate.id+'/decision',{
    method:'POST',cookie:cookieB,
    body:{idempotencyKey:randomUUID(),decision:'accepted',assigneeId:second.data.user.id}});
  assert.equal(memberDenied.status,403,'Only the owner/manager may approve AI proposals');
  const proposalDecision={idempotencyKey:randomUUID(),decision:'accepted',
    assigneeId:second.data.user.id};
  const accepted=await api('/projects/'+pid+'/proposals/'+candidate.id+'/decision',{
    method:'POST',body:proposalDecision});
  assert.equal(accepted.status,200);
  const replayApproval=await api('/projects/'+pid+'/proposals/'+candidate.id+'/decision',{
    method:'POST',body:proposalDecision});
  assert.equal(replayApproval.status,200,'Same approval receipt should be replayable');
  const conflictingApproval=await api('/projects/'+pid+'/proposals/'+candidate.id+'/decision',{
    method:'POST',body:{...proposalDecision,decision:'rejected'}});
  assert.equal(conflictingApproval.status,409);
  const duplicateApproval=await api('/projects/'+pid+'/proposals/'+candidate.id+'/decision',{
    method:'POST',body:{...proposalDecision,idempotencyKey:randomUUID()}});
  assert.equal(duplicateApproval.status,409,'New command may not create duplicate tasks');
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM domain_events
    WHERE project_id=$1 AND aggregate_id=$2 AND kind='proposal.reviewed.v1'`,
    [pid,candidate.id])).rows[0].n,1);
  const linked=await db.query('SELECT id FROM tasks WHERE source_proposal_id=$1',[candidate.id]);
  assert.equal(linked.rowCount,1);
  const riskSuggestion=(await db.query(`INSERT INTO proposed_changes(
    project_id,source_message_id,kind,title,detail)
    VALUES($1,$2,'risk','联调环境不可用风险','审批后保留来源') RETURNING id`,
    [pid,posted.data.message.id])).rows[0];
  const riskApproved=await api('/projects/'+pid+'/proposals/'+riskSuggestion.id+'/decision',{
    method:'POST',body:{idempotencyKey:randomUUID(),decision:'accepted'}});
  assert.equal(riskApproved.status,200,'Risk candidates must be approved by humans');
  const riskLinked=await db.query('SELECT id FROM risks WHERE source_proposal_id=$1',
    [riskSuggestion.id]);
  assert.equal(riskLinked.rowCount,1);
  const riskId=riskLinked.rows[0].id;
  const riskPath='/projects/'+pid+'/risks/'+riskId;
  const beforeAssessment=await api('/projects/'+pid+'/risks');
  assert.equal(beforeAssessment.status,200);
  const aiRisk=beforeAssessment.data.risks.find(r=>r.id===riskId);
  assert.equal(aiRisk.status,'open');
  assert.equal(aiRisk.version,1);
  assert.equal(aiRisk.owner_id,null,'Accepted AI proposals start unassessed');
  assert.equal(aiRisk.likelihood,null,'AI cannot invent formal probability');
  const unassessedStart=await api(riskPath+'/transition',{
    method:'POST',body:{idempotencyKey:randomUUID(),expectedVersion:1,
      decision:'start_mitigation',note:'Premature execution'}});
  assert.equal(unassessedStart.status,409,'Risk mitigation requires human assessment');
  const memberAssessment=await api(riskPath+'/assessment',{method:'PATCH',
    cookie:cookieB,body:{idempotencyKey:randomUUID(),expectedVersion:1,
      likelihood:4,impact:5,ownerId:uid,responsePlan:'Verify backup',
      note:'High probability'}});
  assert.equal(memberAssessment.status,403,
    'Ordinary project members cannot formally score a risk');
  const missingRiskNote=await api(riskPath+'/assessment',{method:'PATCH',body:{
    idempotencyKey:randomUUID(),expectedVersion:1,
    likelihood:4,impact:5,ownerId:uid,responsePlan:'Mitigate outage',note:' '}});
  assert.equal(missingRiskNote.status,400);
  const noRiskOwner=await api(riskPath+'/assessment',{method:'PATCH',body:{
    idempotencyKey:randomUUID(),expectedVersion:1,
    likelihood:4,impact:5,ownerId:randomUUID(),responsePlan:'Mitigate outage',
    note:'Owner must be active'}});
  assert.equal(noRiskOwner.status,400);
  const assessRisk={idempotencyKey:randomUUID(),expectedVersion:1,
    likelihood:4,impact:5,ownerId:uid,responsePlan:'Maintain backup integration',
    note:'Assessed based on integration environment uncertainty'};
  const assessed=await api(riskPath+'/assessment',{method:'PATCH',body:assessRisk});
  assert.equal(assessed.status,200,JSON.stringify(assessed.data));
  assert.equal(assessed.data.risk.version,2);
  assert.equal(assessed.data.risk.owner_id,uid);
  const replayRisk=await api(riskPath+'/assessment',{method:'PATCH',body:assessRisk});
  assert.equal(replayRisk.status,200,'Same assessment command must be idempotent');
  assert.equal(replayRisk.data.risk.version,2);
  const riskKeyCollision=await api(riskPath+'/assessment',{method:'PATCH',body:{
    ...assessRisk,impact:1}});
  assert.equal(riskKeyCollision.status,409,'Same key cannot mean a new assessment');
  const staleRisk=await api(riskPath+'/assessment',{method:'PATCH',body:{
    ...assessRisk,idempotencyKey:randomUUID()}});
  assert.equal(staleRisk.status,409,'Stale risk assessment must not overwrite current version');
  const startRisk={idempotencyKey:randomUUID(),expectedVersion:2,
    decision:'start_mitigation',note:'Backup plan assigned and underway'};
  const started=await api(riskPath+'/transition',{method:'POST',body:startRisk});
  assert.equal(started.status,200);
  assert.equal(started.data.risk.status,'mitigating');
  assert.equal(started.data.risk.version,3);
  assert.equal((await api(riskPath+'/transition',{method:'POST',body:startRisk})).status,
    200,'Original transition receipt must replay safely');
  const duplicateStart=await api(riskPath+'/transition',{method:'POST',body:{
    idempotencyKey:randomUUID(),expectedVersion:3,
    decision:'start_mitigation',note:'Already mitigating'}});
  assert.equal(duplicateStart.status,409);
  const resolvedRisk=await api(riskPath+'/transition',{method:'POST',body:{
    idempotencyKey:randomUUID(),expectedVersion:3,
    decision:'resolve',note:'Integration backup validated with operator'}});
  assert.equal(resolvedRisk.status,200);
  assert.equal(resolvedRisk.data.risk.status,'resolved');
  assert.equal(resolvedRisk.data.risk.version,4);
  const reopenRisk=await api(riskPath+'/transition',{method:'POST',body:{
    idempotencyKey:randomUUID(),expectedVersion:4,
    decision:'reopen',note:'Backup is no longer available'}});
  assert.equal(reopenRisk.status,200);
  assert.equal(reopenRisk.data.risk.status,'open');
  assert.equal(reopenRisk.data.risk.version,5);
  const resumeRisk=await api(riskPath+'/transition',{method:'POST',body:{
    idempotencyKey:randomUUID(),expectedVersion:5,
    decision:'start_mitigation',note:'New backup action in progress'}});
  assert.equal(resumeRisk.status,200);
  assert.equal(resumeRisk.data.risk.status,'mitigating');
  assert.equal(resumeRisk.data.risk.version,6);
  const riskHistory=await api(riskPath+'/history',{cookie:cookieB});
  assert.equal(riskHistory.status,200,'Project members may inspect human decisions');
  assert.deepEqual(riskHistory.data.history.map(h=>h.risk_version),[6,5,4,3,2]);
  assert.deepEqual(riskHistory.data.history.map(h=>h.action),
    ['transition','transition','transition','transition','assessment']);
  const scopedRisk=await api('/projects/'+randomUUID()+'/risks/'+riskId+'/history');
  assert.equal(scopedRisk.status,404,'Risk history cannot be read across projects');
  const riskEvents=(await db.query(`
    SELECT kind,aggregate_version AS version FROM domain_events
    WHERE project_id=$1 AND aggregate_id=$2
      AND kind IN ('risk.assessed.v1','risk.transitioned.v1')
    ORDER BY aggregate_version`,[pid,riskId])).rows;
  assert.deepEqual(riskEvents.map(x=>x.version),[2,3,4,5,6]);
  assert.equal(riskEvents.filter(x=>x.kind==='risk.assessed.v1').length,1,
    'Receipt replay does not create a second assessment event');
  const riskAudit=(await db.query(`SELECT count(*)::int AS n FROM audit_entries
    WHERE project_id=$1 AND target_id=$2 AND action LIKE 'risk.%'`,
    [pid,riskId])).rows[0].n;
  assert.equal(riskAudit,5,'Each real risk change has one audit entry');

  // Stats must count the entire project, not only the first 200 listed tasks.
  await db.query(
    "INSERT INTO tasks(project_id,title) SELECT $1,'批量任务-'||n FROM generate_series(1,205) AS n",
    [pid]);
  // Model-derived clarification is only a suggestion; the owner confirms final facts.
  const candidate2=(await db.query(
    `INSERT INTO proposed_changes(project_id,source_message_id,kind,title)
     VALUES($1,$2,'task','待澄清交付') RETURNING id`,
    [pid,posted.data.message.id])).rows[0];
  await db.query(
    `INSERT INTO clarification_threads(proposal_id,project_id,status,
       assignee_hint,due_at,response_message_id)
     VALUES($1,$2,'answered','张工',$3,$4)`,
    [candidate2.id,pid,new Date(Date.now()+2*86400000).toISOString(),posted.data.message.id]);
  const suggested=await api('/projects/'+pid+'/proposals');
  assert.equal(suggested.status,200);
  assert.equal(suggested.data.proposals.find(x=>x.id===candidate2.id)?.clarification_status,'answered');
  const approved2=await api('/projects/'+pid+'/proposals/'+candidate2.id+'/decision',{
    method:'POST',body:{idempotencyKey:randomUUID(),decision:'accepted',assigneeId:uid}});
  assert.equal(approved2.status,200);
  const saved2=await db.query(
    'SELECT due_date,assignee_id FROM tasks WHERE source_proposal_id=$1',[candidate2.id]);
  assert.equal(saved2.rows[0].assignee_id,uid);
  assert.ok(saved2.rows[0].due_date,'Approved clarification should supply the confirmed date');
  const closed=await db.query('SELECT status FROM clarification_threads WHERE proposal_id=$1',[candidate2.id]);
  assert.equal(closed.rows[0].status,'closed');

  const dead=(await db.query(
    `INSERT INTO outbox_events(project_id,kind,attempts,dead_at,last_error_code)
     VALUES($1,'message.created',8,NOW(),'MODEL_HTTP_429') RETURNING id`,
    [pid])).rows[0];
  const memberDead=await api('/projects/'+pid+'/outbox/dead',{cookie:cookieB});
  assert.equal(memberDead.status,403,'Only owner can read dead-letter details');
  const memberSummary=await api('/projects/'+pid+'/outbox/summary',{cookie:cookieB});
  assert.equal(memberSummary.status,403);
  const ownerSummary=await api('/projects/'+pid+'/outbox/summary');
  assert.equal(ownerSummary.status,200);
  assert.ok(ownerSummary.data.summary.dead>=1);
  const ownerDead=await api('/projects/'+pid+'/outbox/dead');
  assert.ok(ownerDead.data.events.some(x=>x.id===dead.id));
  const retryPath='/projects/'+pid+'/outbox/'+dead.id+'/retry';
  const memberRetry=await api(retryPath,{
    method:'POST',cookie:cookieB,body:{idempotencyKey:randomUUID()}});
  assert.equal(memberRetry.status,403,'Members cannot replay events');
  const retryInput={idempotencyKey:randomUUID()};
  const ownerRetry=await api(retryPath,{method:'POST',body:retryInput});
  assert.equal(ownerRetry.status,200);
  assert.equal(ownerRetry.data.recoveryRevision,1,'First manual recovery is version 1');
  const replayReceipt=await api(retryPath,{method:'POST',body:retryInput});
  assert.equal(replayReceipt.status,200,'Same retry command must replay its durable receipt');
  assert.equal(replayReceipt.data.recoveryRevision,1,'Replay must not increment recovery revision');
  const unkeyedRetry=await api(retryPath,{method:'POST'});
  assert.equal(unkeyedRetry.status,400,'An unkeyed retry command must be rejected');
  const repeatedRetry=await api(retryPath,{
    method:'POST',body:{idempotencyKey:randomUUID()}});
  assert.equal(repeatedRetry.status,409,'Already queued events may not be replayed twice');
  const retryDomainEvents=(await db.query(`
    SELECT count(*)::int AS n FROM domain_events
    WHERE project_id=$1 AND aggregate_id=$2 AND kind='outbox.dead_letter_retried.v1'`,
    [pid,dead.id])).rows[0].n;
  assert.equal(retryDomainEvents,1,
    'A retried recovery receipt cannot append duplicate domain events');
  const retryOutbox=(await db.query(`
    SELECT count(*)::int AS n FROM outbox_events o
    JOIN domain_events d ON o.payload->>'domainEventId'=d.id::text
    WHERE d.project_id=$1 AND d.aggregate_id=$2
      AND d.kind='outbox.dead_letter_retried.v1'`,[pid,dead.id])).rows[0].n;
  assert.equal(retryOutbox,1,'Recovery must create one durable outbox notice');
  const queued=await db.query(
    'SELECT attempts,dead_at,manual_retry_revision FROM outbox_events WHERE id=$1',
    [dead.id]);
  assert.equal(queued.rows[0].attempts,0);
  assert.equal(queued.rows[0].dead_at,null);
  assert.equal(queued.rows[0].manual_retry_revision,1);
  // The same event may legitimately become dead again on a later attempt.
  // A fresh human recovery is a new aggregate version, never another v1.
  await db.query(`UPDATE outbox_events SET attempts=8,dead_at=NOW(),
    last_error_code='MODEL_HTTP_429'
    WHERE id=$1 AND processed_at IS NULL`,[dead.id]);
  const secondRecovery=await api(retryPath,{
    method:'POST',body:{idempotencyKey:randomUUID()}});
  assert.equal(secondRecovery.status,200);
  assert.equal(secondRecovery.data.recoveryRevision,2);
  const recoveryVersions=(await db.query(`SELECT aggregate_version AS version
    FROM domain_events WHERE project_id=$1 AND aggregate_id=$2
      AND kind='outbox.dead_letter_retried.v1'
    ORDER BY aggregate_version`,[pid,dead.id])).rows;
  assert.deepEqual(recoveryVersions.map(x=>x.version),[1,2]);

  // Count after accepting the clarified task, not before it.
  const beforeCount=Number((await db.query(
    'SELECT COUNT(*) AS total FROM tasks WHERE project_id=$1',[pid])).rows[0].total);
  const reportInput={idempotencyKey:randomUUID(),kind:'week'};
  const report=await api('/projects/'+pid+'/reports',{method:'POST',body:reportInput});
  assert.equal(report.status,200,JSON.stringify(report.data));
  assert.equal(report.data.report.state,'draft');
  assert.ok(report.data.report.revision>=1);
  assert.ok(report.data.report.content.includes('总数：'+beforeCount+'；'),
    'Report counts must not be truncated to 200');
  assert.ok(report.data.report.content.includes('联调环境不可用风险'),
    'Mitigating risk must still be reported as unresolved');
  const reportReplay=await api('/projects/'+pid+'/reports',{method:'POST',body:reportInput});
  assert.equal(reportReplay.status,200,'Same report command must replay receipt');
  assert.equal(reportReplay.data.report.id,report.data.report.id);
  assert.equal(reportReplay.data.report.revision,report.data.report.revision);
  const reportKeyCollision=await api('/projects/'+pid+'/reports',{
    method:'POST',body:{...reportInput,kind:'month'}});
  assert.equal(reportKeyCollision.status,409,'A report command key cannot mean a new kind');
  const unkeyedReport=await api('/projects/'+pid+'/reports',{
    method:'POST',body:{kind:'week'}});
  assert.equal(unkeyedReport.status,400,'A report request must carry an idempotency key');
  const deniedReport=await api('/projects/'+pid+'/reports',{
    method:'POST',cookie:cookieB,
    body:{idempotencyKey:randomUUID(),kind:'month'}});
  assert.equal(deniedReport.status,403,'Project members cannot generate official reports');

  const changedTask=await api('/projects/'+pid+'/tasks',{method:'POST',
    body:{idempotencyKey:randomUUID(),title:'晚于草稿新增的任务',
      assigneeId:null,dueDate:null}});
  assert.equal(changedTask.status,201);
  const refreshed=await api('/projects/'+pid+'/reports',{method:'POST',
    body:{idempotencyKey:randomUUID(),kind:'week'}});
  assert.equal(refreshed.status,200);
  assert.equal(refreshed.data.report.id,report.data.report.id);
  assert.equal(refreshed.data.report.revision,report.data.report.revision+1,
    'A refreshed draft must advance its revision once');
  assert.ok(refreshed.data.report.content.includes('总数：'+(beforeCount+1)+'；'),
    'Regenerated draft must reflect new data');
  const publishBase='/projects/'+pid+'/reports/'+report.data.report.id+'/publish';
  const stalePublication=await api(publishBase,{method:'POST',
    body:{idempotencyKey:randomUUID(),expectedRevision:report.data.report.revision}});
  assert.equal(stalePublication.status,409,
    'Outdated report content may not be published');
  const publishInput={idempotencyKey:randomUUID(),
    expectedRevision:refreshed.data.report.revision};
  const published=await api(publishBase,{method:'POST',body:publishInput});
  assert.equal(published.status,200,JSON.stringify(published.data));
  assert.equal(published.data.report.state,'published');
  assert.equal(published.data.report.revision,refreshed.data.report.revision+1);
  assert.equal(published.data.report.published_by,uid);
  assert.ok(published.data.report.published_at);
  const publishedReplay=await api(publishBase,{method:'POST',body:publishInput});
  assert.equal(publishedReplay.status,200,'Same publication command should replay');
  assert.equal(publishedReplay.data.report.revision,published.data.report.revision);
  const publicationKeyCollision=await api(publishBase,{method:'POST',
    body:{...publishInput,expectedRevision:refreshed.data.report.revision+1}});
  assert.equal(publicationKeyCollision.status,409);
  const repeatedPublication=await api(publishBase,{method:'POST',
    body:{...publishInput,idempotencyKey:randomUUID()}});
  assert.equal(repeatedPublication.status,409,
    'A second publication command must be refused');
  const immutable=await api('/projects/'+pid+'/reports',{method:'POST',
    body:{idempotencyKey:randomUUID(),kind:'week'}});
  assert.equal(immutable.status,200);
  assert.equal(immutable.data.report.content,refreshed.data.report.content,
    'Published reports must remain immutable');
  assert.equal(immutable.data.report.revision,published.data.report.revision,
    'Requesting a published report must not advance its revision');
  const reportEvents=(await db.query(`
    SELECT kind,count(*)::int AS n FROM domain_events
    WHERE project_id=$1 AND aggregate_id=$2
      AND kind IN ('report.generation_requested.v1','report.published.v1')
    GROUP BY kind`,[pid,report.data.report.id])).rows;
  assert.equal(reportEvents.find(x=>x.kind==='report.generation_requested.v1')?.n,3);
  assert.equal(reportEvents.find(x=>x.kind==='report.published.v1')?.n,1);

  // Ownership must be atomically unique and transferable without losing
  // a retry receipt when the previous owner becomes a manager.
  const transferPath='/projects/'+pid+'/ownership-transfer';
  const transferDenied=await api(transferPath,{method:'POST',cookie:cookieB,
    body:{idempotencyKey:randomUUID(),expectedRevision:1,targetUserId:uid}});
  assert.equal(transferDenied.status,403,'A project member cannot claim owner authority');
  const selfTransfer=await api(transferPath,{method:'POST',body:{
    idempotencyKey:randomUUID(),expectedRevision:1,targetUserId:uid}});
  assert.equal(selfTransfer.status,400);
  const unknownSuccessor=await api(transferPath,{method:'POST',body:{
    idempotencyKey:randomUUID(),expectedRevision:1,targetUserId:randomUUID()}});
  assert.equal(unknownSuccessor.status,400,'Successor must be a current tenant/project member');
  const transferInput={idempotencyKey:randomUUID(),expectedRevision:1,
    targetUserId:second.data.user.id};
  const transferred=await api(transferPath,{method:'POST',body:transferInput});
  assert.equal(transferred.status,200,JSON.stringify(transferred.data));
  assert.equal(transferred.data.ownerId,second.data.user.id);
  assert.equal(transferred.data.previousOwnerId,uid);
  assert.equal(transferred.data.ownershipRevision,2);
  const transferredProject=await db.query(
    'SELECT owner_id,ownership_revision FROM projects WHERE id=$1',[pid]);
  assert.equal(transferredProject.rows[0].owner_id,second.data.user.id);
  assert.equal(transferredProject.rows[0].ownership_revision,2);
  const firstOwners=await db.query(
    "SELECT user_id,role FROM project_members WHERE project_id=$1 AND role='owner'",
    [pid]);
  assert.deepEqual(firstOwners.rows.map(x=>x.user_id),[second.data.user.id]);
  const afterTransferRoles=await api('/projects');
  assert.equal(afterTransferRoles.data.projects.find(p=>p.id===pid).role,'manager');
  const bProjects=await api('/projects',{cookie:cookieB});
  assert.equal(bProjects.data.projects.find(p=>p.id===pid).role,'owner');
  const originalTransferRetry=await api(transferPath,{method:'POST',body:transferInput});
  assert.equal(originalTransferRetry.status,200,
    'A former owner can replay their exact successful command while still a project member');
  assert.equal(originalTransferRetry.data.ownershipRevision,2);
  const transferKeyConflict=await api(transferPath,{method:'POST',body:{
    ...transferInput,targetUserId:uid}});
  assert.equal(transferKeyConflict.status,409,'A command key cannot mean another successor');
  const formerOwnerNewTransfer=await api(transferPath,{method:'POST',body:{
    idempotencyKey:randomUUID(),expectedRevision:2,targetUserId:uid}});
  assert.equal(formerOwnerNewTransfer.status,403,
    'Former owner cannot issue a NEW project transfer command');
  const staleOwnerTransfer=await api(transferPath,{method:'POST',cookie:cookieB,
    body:{idempotencyKey:randomUUID(),expectedRevision:1,targetUserId:uid}});
  assert.equal(staleOwnerTransfer.status,409,'Transfer must reject old ownership revision');
  const returnInput={idempotencyKey:randomUUID(),expectedRevision:2,targetUserId:uid};
  const returned=await api(transferPath,{
    method:'POST',cookie:cookieB,body:returnInput});
  assert.equal(returned.status,200,JSON.stringify(returned.data));
  assert.equal(returned.data.ownershipRevision,3);
  assert.equal(returned.data.ownerId,uid);
  const returnReplay=await api(transferPath,{
    method:'POST',cookie:cookieB,body:returnInput});
  assert.equal(returnReplay.status,200,'Demoted second owner may replay their previous receipt');
  assert.equal(returnReplay.data.ownershipRevision,3);
  const finalOwners=await db.query(
    "SELECT user_id FROM project_members WHERE project_id=$1 AND role='owner'",
    [pid]);
  assert.deepEqual(finalOwners.rows.map(x=>x.user_id),[uid]);
  const ownerEvents=(await db.query(`SELECT aggregate_version AS version
    FROM domain_events WHERE project_id=$1 AND aggregate_id=$1
      AND kind='project.ownership_transferred.v1' ORDER BY aggregate_version`,
    [pid])).rows;
  assert.deepEqual(ownerEvents.map(x=>x.version),[2,3]);
  const ownerAudits=(await db.query(`SELECT count(*)::int AS n
    FROM audit_entries WHERE project_id=$1
      AND action='project.ownership_transferred.v1'`,[pid])).rows[0].n;
  assert.equal(ownerAudits,2);
  await assert.rejects(db.query(`
    UPDATE project_members SET role='owner' WHERE project_id=$1 AND user_id=$2
    `,[pid,second.data.user.id]),
    (error)=>error?.code==='23505',
    'Database unique partial index must prevent a second project owner');
  const demotedAfterReturn=await api(memberPath,{method:'PATCH',body:{
    idempotencyKey:randomUUID(),role:'member'}});
  assert.equal(demotedAfterReturn.status,200,
    'Former owner may be assigned a regular role after transfer');

  const removeDenied=await api('/projects/'+pid+'/members/'+second.data.user.id,{
    method:'DELETE',cookie:cookieB,body:{idempotencyKey:randomUUID()}});
  assert.equal(removeDenied.status,403);
  const blockedRemoval=await api('/projects/'+pid+'/members/'+second.data.user.id,{
    method:'DELETE',body:{idempotencyKey:randomUUID()}});
  assert.equal(blockedRemoval.status,409,'Members with unfinished assigned tasks must be reassigned first');
  const reassigned=await api('/projects/'+pid+'/tasks/'+linked.rows[0].id,{
    method:'PATCH',body:{idempotencyKey:randomUUID(),version:1,assigneeId:uid}});
  assert.equal(reassigned.status,200,'Owner can reassign unfinished work before removing a member');
  const historical=await api('/projects/'+pid+'/tasks',{method:'POST',body:{idempotencyKey:randomUUID(),
    title:'保留历史负责人',assigneeId:second.data.user.id,dueDate:null}});
  assert.equal(historical.status,201);
  const markDone=await api('/projects/'+pid+'/tasks/'+historical.data.task.id,{
    method:'PATCH',body:{idempotencyKey:randomUUID(),version:historical.data.task.version,status:'done'}});
  assert.equal(markDone.status,200);
  const promoteBeforeRemoval=await api(memberPath,{method:'PATCH',
    body:{idempotencyKey:randomUUID(),role:'manager'}});
  assert.equal(promoteBeforeRemoval.status,200);
  const removalInput={idempotencyKey:randomUUID()};
  const removed=await api(memberPath,{method:'DELETE',body:removalInput});
  assert.equal(removed.status,200);
  assert.equal((await api(memberPath,{method:'DELETE',body:removalInput})).status,200,
    'Same removal request must return durable receipt');
  assert.equal((await api(memberPath,{method:'DELETE',
    body:{idempotencyKey:randomUUID()}})).status,404,
    'Removing the same member with a new command must not create another event');
  const removeEvents=(await db.query(`SELECT count(*)::int AS n
    FROM domain_events WHERE project_id=$1 AND aggregate_id=$2
      AND kind='project.member_removed.v1'`,
    [pid,second.data.user.id])).rows[0].n;
  assert.equal(removeEvents,1,'Repeated removal cannot append a second domain event');
  const reopenFormerMember=await api('/projects/'+pid+'/tasks/'+historical.data.task.id,{
    method:'PATCH',body:{idempotencyKey:randomUUID(),version:markDone.data.task.version,status:'doing'}});
  assert.equal(reopenFormerMember.status,400,'Reopening must reject a revoked assignee');
  const revokedMember=await api('/projects/'+pid+'/messages',{cookie:cookieB});
  assert.equal(revokedMember.status,404,'Removed member must lose access immediately');
  const loggedOut=await api('/auth/logout',{method:'POST'});
  assert.equal(loggedOut.status,200);
  const revokedSession=await api('/me');
  assert.equal(revokedSession.status,401,'Logout must revoke the server-side session');
  console.log('API smoke tests passed: tenant selection, revocable sessions, membership, ordering, idempotency, AI review, outbox and reports.');
}finally{
  await db.end();
  server.kill('SIGTERM');
  await delay(250);
}
