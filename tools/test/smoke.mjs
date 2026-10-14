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
  const created=await api('/projects',{method:'POST',body:{
    name:'集成测试项目',tenantId,timezone:'Asia/Shanghai'}});
  assert.equal(created.status,201,JSON.stringify(created.data));
  const pid=created.data.project.id;
  assert.equal(created.data.project.ai_enabled,false);
  const listedInitial=await api('/projects');
  assert.equal(listedInitial.status,200);
  const initialProject=listedInitial.data.projects.find(p=>p.id===pid);
  assert.ok(initialProject,'New project must be returned in the project list');
  assert.equal(initialProject.work_start,null,'Unset work start must be explicit null');
  assert.equal(initialProject.work_end,null,'Unset work end must be explicit null');
  assert.equal(initialProject.cooldown_hours,null,'Unset cooldown must be explicit null');
  const suffix2=randomUUID().slice(0,8);
  const second=await api('/auth/register',{method:'POST',cookie:'',body:{
    email:'second+'+suffix2+'@example.com',password:'Passw0rd-Strong-123',displayName:'李工',
  }});
  assert.equal(second.status,200,JSON.stringify(second.data));
  cookieB=second.cookie;assert.ok(cookieB);
  const forbidden=await api('/projects/'+pid+'/messages',{cookie:cookieB});
  assert.equal(forbidden.status,404,'Cross-project read must not be allowed');
  const denied=await api('/projects/'+pid+'/tasks',{method:'POST',cookie:cookieB,
    body:{title:'越权任务',assigneeId:null,dueDate:null}});
  assert.equal(denied.status,404,'Cross-project write must not be allowed');
  const unauthorizedTenant=await api('/projects',{method:'POST',cookie:cookieB,body:{
    name:'不能创建的项目',tenantId,timezone:'Asia/Shanghai'}});
  assert.equal(unauthorizedTenant.status,403,'Cannot create projects in another tenant');
  const addOrgMember=await api('/tenants/'+tenantId+'/members',{
    method:'POST',body:{email:'second+'+suffix2+'@example.com'}});
  assert.equal(addOrgMember.status,200,'Tenant administrator must enroll person first');
  const invited=await api('/projects/'+pid+'/members',{method:'POST',body:{
    email:'second+'+suffix2+'@example.com',
  }});
  assert.equal(invited.status,200,'Owner should be able to add a registered project member');
  const memberView=await api('/projects/'+pid+'/members',{cookie:cookieB});
  assert.equal(memberView.status,200);
  const ownerOnly=await api('/projects/'+pid+'/settings',{method:'PATCH',cookie:cookieB,
    body:{aiEnabled:false,workStart:9,workEnd:18,cooldownHours:24}});
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
  assert.equal(messages.data.messages.length,1);
  const secondProject=await api('/projects',{method:'POST',body:{
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
  const task=await api('/projects/'+pid+'/tasks',{method:'POST',
    body:{title:'正式任务',detail:'',assigneeId:uid,dueDate:null}});
  assert.equal(task.status,201,JSON.stringify(task.data));
  const tid=task.data.task.id;
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
    method:'POST',cookie:cookieB,body:{decision:'accepted'}});
  assert.equal(progressForbidden.status,403);
  const progressAccepted=await api('/projects/'+pid+'/progress/'+progressInsert.id+'/decision',{
    method:'POST',body:{decision:'accepted'}});
  assert.equal(progressAccepted.status,200);
  const progressAgain=await api('/projects/'+pid+'/progress/'+progressInsert.id+'/decision',{
    method:'POST',body:{decision:'accepted'}});
  assert.equal(progressAgain.status,409);

  const changed=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',
    body:{status:'doing',version:1}});
  assert.equal(changed.status,200);
  const stale=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',
    body:{status:'done',version:1}});
  assert.equal(stale.status,409,'Stale versions must not overwrite task state');
  const edited=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',body:{
    version:2,assigneeId:uid,dueDate:new Date(Date.now()+86400000).toISOString().slice(0,10),
  }});
  assert.equal(edited.status,200,'Owner may edit task plan');
  const configured=await api('/projects/'+pid+'/settings',{method:'PATCH',body:{
    aiEnabled:false,workStart:9,workEnd:18,cooldownHours:24,
  }});
  assert.equal(configured.status,200);
  const listedConfigured=await api('/projects');
  assert.equal(listedConfigured.status,200);
  const configuredProject=listedConfigured.data.projects.find(p=>p.id===pid);
  assert.equal(configuredProject.work_start,9);
  assert.equal(configuredProject.work_end,18);
  assert.equal(configuredProject.cooldown_hours,24);
  const followup=await db.query(
    'SELECT active FROM followup_plans WHERE task_id=$1',[tid]);
  assert.equal(followup.rows[0]?.active,true,'Task follow-up must be durable');
  await db.query(
    "UPDATE followup_plans SET last_sent_at=NOW(),next_at=NOW()+INTERVAL '24 hours' WHERE task_id=$1",
    [tid]);
  const replanned=await api('/projects/'+pid+'/tasks/'+tid,{method:'PATCH',
    body:{version:edited.data.task.version,
      dueDate:new Date(Date.now()+3*86400000).toISOString().slice(0,10)}});
  assert.equal(replanned.status,200,'Replanning should succeed');
  const cooldown=await db.query(
    "SELECT next_at >= last_sent_at + INTERVAL '24 hours' AS preserved FROM followup_plans WHERE task_id=$1",
    [tid]);
  assert.equal(cooldown.rows[0]?.preserved,true,'Replanning must preserve last reminder cooldown');

  const candidate=(await db.query(
    `INSERT INTO proposed_changes(project_id,source_message_id,kind,title,detail)
     VALUES($1,$2,'task',$3,'请核对') RETURNING id`,
    [pid,posted.data.message.id,'来自聊天的候选任务'])).rows[0];
  const memberDenied=await api('/projects/'+pid+'/proposals/'+candidate.id+'/decision',{
    method:'POST',cookie:cookieB,body:{decision:'accepted',assigneeId:second.data.user.id}});
  assert.equal(memberDenied.status,403,'Only the project owner may approve AI proposals');
  const accepted=await api('/projects/'+pid+'/proposals/'+candidate.id+'/decision',{
    method:'POST',body:{decision:'accepted',assigneeId:second.data.user.id}});
  assert.equal(accepted.status,200);
  const duplicateApproval=await api('/projects/'+pid+'/proposals/'+candidate.id+'/decision',{
    method:'POST',body:{decision:'accepted',assigneeId:second.data.user.id}});
  assert.equal(duplicateApproval.status,409,'Proposal must not create duplicate tasks');
  const linked=await db.query('SELECT id FROM tasks WHERE source_proposal_id=$1',[candidate.id]);
  assert.equal(linked.rowCount,1);

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
    method:'POST',body:{decision:'accepted',assigneeId:uid}});
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
  const memberRetry=await api('/projects/'+pid+'/outbox/'+dead.id+'/retry',{
    method:'POST',cookie:cookieB});
  assert.equal(memberRetry.status,403,'Members cannot replay events');
  const ownerRetry=await api('/projects/'+pid+'/outbox/'+dead.id+'/retry',{method:'POST'});
  assert.equal(ownerRetry.status,200);
  const repeatedRetry=await api('/projects/'+pid+'/outbox/'+dead.id+'/retry',{method:'POST'});
  assert.equal(repeatedRetry.status,409,'Already queued events may not be replayed twice');
  const queued=await db.query('SELECT attempts,dead_at FROM outbox_events WHERE id=$1',[dead.id]);
  assert.equal(queued.rows[0].attempts,0);
  assert.equal(queued.rows[0].dead_at,null);

  // Count after accepting the clarified task, not before it.
  const beforeCount=Number((await db.query(
    'SELECT COUNT(*) AS total FROM tasks WHERE project_id=$1',[pid])).rows[0].total);
  const report=await api('/projects/'+pid+'/reports',{method:'POST',body:{kind:'week'}});
  assert.equal(report.status,200,JSON.stringify(report.data));
  assert.equal(report.data.report.state,'draft');
  assert.ok(report.data.report.content.includes('总数：'+beforeCount+'；'),
    'Report counts must not be truncated to 200');
  const changedTask=await api('/projects/'+pid+'/tasks',{method:'POST',
    body:{title:'晚于草稿新增的任务',assigneeId:null,dueDate:null}});
  assert.equal(changedTask.status,201);
  const refreshed=await api('/projects/'+pid+'/reports',{method:'POST',body:{kind:'week'}});
  assert.equal(refreshed.data.report.id,report.data.report.id);
  assert.ok(refreshed.data.report.content.includes('总数：'+(beforeCount+1)+'；'),
    'Regenerated draft must reflect new data');
  const published=await api('/projects/'+pid+'/reports/'+report.data.report.id+'/publish',{method:'POST'});
  assert.equal(published.status,200);
  const immutable=await api('/projects/'+pid+'/reports',{method:'POST',body:{kind:'week'}});
  assert.equal(immutable.data.report.content,refreshed.data.report.content,
    'Published reports must remain immutable');
  const removeDenied=await api('/projects/'+pid+'/members/'+second.data.user.id,{
    method:'DELETE',cookie:cookieB});
  assert.equal(removeDenied.status,403);
  const blockedRemoval=await api('/projects/'+pid+'/members/'+second.data.user.id,{method:'DELETE'});
  assert.equal(blockedRemoval.status,409,'Members with unfinished assigned tasks must be reassigned first');
  const reassigned=await api('/projects/'+pid+'/tasks/'+linked.rows[0].id,{
    method:'PATCH',body:{version:1,assigneeId:uid}});
  assert.equal(reassigned.status,200,'Owner can reassign unfinished work before removing a member');
  const historical=await api('/projects/'+pid+'/tasks',{method:'POST',body:{
    title:'保留历史负责人',assigneeId:second.data.user.id,dueDate:null}});
  assert.equal(historical.status,201);
  const markDone=await api('/projects/'+pid+'/tasks/'+historical.data.task.id,{
    method:'PATCH',body:{version:historical.data.task.version,status:'done'}});
  assert.equal(markDone.status,200);
  const removed=await api('/projects/'+pid+'/members/'+second.data.user.id,{method:'DELETE'});
  assert.equal(removed.status,200);
  const reopenFormerMember=await api('/projects/'+pid+'/tasks/'+historical.data.task.id,{
    method:'PATCH',body:{version:markDone.data.task.version,status:'doing'}});
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
