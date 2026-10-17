import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {
  listProjectMembers,addProjectMember,changeProjectMemberRole,
  removeProjectMember,transferProjectOwnership,updateProjectSettings,
} from '../src/identity/project-governance.ts';

const suffix=randomUUID();
async function newUser(label:string):Promise<string>{
  const {rows}=await pool.query<{id:string}>(`
    INSERT INTO users(email,display_name,password_hash)
    VALUES($1,$2,'not-login') RETURNING id
  `,[label+'-'+suffix+'@example.test',label]);
  return rows[0].id;
}
try{
  const owner=await newUser('governance-owner');
  const member=await newUser('governance-member');
  const candidate=await newUser('governance-candidate');
  const external=await newUser('governance-outsider');
  const tenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Governance commands') RETURNING id
  `)).rows[0].id;
  const outsiderTenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Governance other tenant') RETURNING id
  `)).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member'),($1,$4,'member'),
      ($5,$6,'admin')
  `,[tenant,owner,member,candidate,outsiderTenant,external]);
  const project=(await pool.query<{id:string}>(`
    INSERT INTO projects(tenant_id,name,owner_id)
    VALUES($1,'Governance project',$2) RETURNING id
  `,[tenant,owner])).rows[0].id;
  const foreignProject=(await pool.query<{id:string}>(`
    INSERT INTO projects(tenant_id,name,owner_id)
    VALUES($1,'Foreign project',$2) RETURNING id
  `,[outsiderTenant,external])).rows[0].id;
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'owner'),($1,$3,'member'),($4,$5,'owner')
  `,[project,owner,member,foreignProject,external]);

  const members=await listProjectMembers(project,member);
  assert.deepEqual(new Set(members.members.map(x=>x.id)),new Set([owner,member]));
  await assert.rejects(listProjectMembers(project,external),/项目不存在或无权限/);
  await assert.rejects(listProjectMembers(foreignProject,owner),/项目不存在或无权限/);

  const invite={email:'governance-candidate-'+suffix+'@example.test',
    idempotencyKey:randomUUID()};
  const added=await addProjectMember(project,owner,invite);
  assert.deepEqual(added,{ok:true});
  assert.deepEqual(await addProjectMember(project,owner,invite),added);
  await assert.rejects(addProjectMember(project,owner,
    {...invite,email:'governance-member-'+suffix+'@example.test'}),
    /幂等键已经用于其他命令/);
  await assert.rejects(addProjectMember(project,member,
    {email:'governance-owner-'+suffix+'@example.test',idempotencyKey:randomUUID()}),
    /没有执行该操作的权限/);
  await assert.rejects(addProjectMember(project,owner,
    {email:'governance-outsider-'+suffix+'@example.test',idempotencyKey:randomUUID()}),
    /请先由组织管理员将人员加入该组织/);

  // One shared Core guard applies equally to removal and observer downgrade.
  const expectBothBlocked=async(message:RegExp)=>{
    await assert.rejects(changeProjectMemberRole(project,member,owner,
      {idempotencyKey:randomUUID(),role:'observer'}),message);
    await assert.rejects(removeProjectMember(project,member,owner,
      {idempotencyKey:randomUUID()}),message);
  };
  const task=(await pool.query<{id:string}>(`
    INSERT INTO tasks(project_id,title,assignee_id)
    VALUES($1,'Pending assignment',$2) RETURNING id
  `,[project,member])).rows[0].id;
  await expectBothBlocked(/未完成任务/);
  await pool.query("UPDATE tasks SET status='done' WHERE id=$1",[task]);

  const deliverable=(await pool.query<{id:string}>(`
    INSERT INTO project_deliverables(
      project_id,title,acceptance_criteria,assignee_id,created_by)
    VALUES($1,'Deliverable','Human verification',$2,$3) RETURNING id
  `,[project,member,owner])).rows[0].id;
  await expectBothBlocked(/待处理交付物/);
  await pool.query(`UPDATE project_deliverables
    SET status='accepted',submitted_by=$2,reviewed_by=$3,reviewed_at=NOW()
    WHERE id=$1`,[deliverable,member,owner]);

  const allocation=(await pool.query<{id:string}>(`
    INSERT INTO resource_allocations(tenant_id,project_id,user_id,
      percentage,start_date,end_date)
    VALUES($1,$2,$3,50,CURRENT_DATE,CURRENT_DATE+INTERVAL '10 days') RETURNING id
  `,[tenant,project,member])).rows[0].id;
  await expectBothBlocked(/有效资源投入/);
  await pool.query(`UPDATE resource_allocations
    SET cancelled_at=NOW(),cancelled_by=$2 WHERE id=$1`,[allocation,owner]);

  const risk=(await pool.query<{id:string}>(`
    INSERT INTO risks(project_id,title,owner_id)
    VALUES($1,'Threat',$2) RETURNING id
  `,[project,member])).rows[0].id;
  await expectBothBlocked(/未关闭风险/);
  await pool.query("UPDATE risks SET status='resolved' WHERE id=$1",[risk]);

  const change=(await pool.query<{id:string}>(`
    INSERT INTO project_change_requests(
      project_id,title,rationale,impact,status,created_by,decided_by,decided_at,
      implementation_owner_id,implementation_started_at)
    VALUES($1,'Scope adjustment','Rationale','Impact',
      'implementing',$2,$2,NOW(),$3,NOW()) RETURNING id
  `,[project,owner,member])).rows[0].id;
  await expectBothBlocked(/实施中的变更/);
  await pool.query("UPDATE project_change_requests SET status='approved' WHERE id=$1",
    [change]);

  await assert.rejects(changeProjectMemberRole(project,owner,owner,
    {idempotencyKey:randomUUID(),role:'observer'}),
    /不能修改项目负责人的角色/);
  await assert.rejects(removeProjectMember(project,owner,owner,
    {idempotencyKey:randomUUID()}),/不能通过此接口移除项目负责人/);
  const toObserver={idempotencyKey:randomUUID(),role:'observer' as const};
  const downgraded=await changeProjectMemberRole(project,member,owner,toObserver);
  assert.deepEqual(downgraded,{ok:true});
  assert.deepEqual(await changeProjectMemberRole(
    project,member,owner,toObserver),downgraded);
  await assert.rejects(changeProjectMemberRole(project,member,owner,
    {idempotencyKey:randomUUID(),role:'observer'}),/成员已处于目标角色/);
  assert.ok((await listProjectMembers(project,member)).members
    .some(x=>x.id===member&&x.role==='observer'));
  const removed=await removeProjectMember(project,member,owner,
    {idempotencyKey:randomUUID()});
  assert.deepEqual(removed,{ok:true});
  await assert.rejects(listProjectMembers(project,member),/项目不存在或无权限/);

  const settings={idempotencyKey:randomUUID(),expectedRevision:1,
    aiEnabled:false,workStart:9,workEnd:18,cooldownHours:24};
  await assert.rejects(updateProjectSettings(project,candidate,settings),
    /没有执行该操作的权限/);
  const saved=await updateProjectSettings(project,owner,settings);
  assert.equal(saved.settingsRevision,2);
  assert.deepEqual(await updateProjectSettings(project,owner,settings),saved);
  await assert.rejects(updateProjectSettings(project,owner,
    {...settings,idempotencyKey:randomUUID()}),/项目设置版本已变化/);
  await assert.rejects(updateProjectSettings(project,owner,
    {...settings,idempotencyKey:randomUUID(),expectedRevision:2,
      workStart:18,workEnd:9}),/提醒策略必须完整配置/);

  const revision={idempotencyKey:randomUUID(),targetUserId:candidate,
    expectedRevision:1};
  await assert.rejects(transferProjectOwnership(project,candidate,revision),
    /没有执行该操作的权限/);
  const moved=await transferProjectOwnership(project,owner,revision);
  assert.equal(moved.ownerId,candidate);
  assert.equal(moved.ownershipRevision,2);
  assert.deepEqual(await transferProjectOwnership(project,owner,revision),moved);
  const {rows:ownership}=await pool.query<{
    owner_id:string;ownership_revision:number;
  }>('SELECT owner_id,ownership_revision FROM projects WHERE id=$1',[project]);
  assert.equal(ownership[0].owner_id,candidate);
  assert.equal(ownership[0].ownership_revision,2);
  await assert.rejects(updateProjectSettings(project,owner,
    {...settings,idempotencyKey:randomUUID(),expectedRevision:2}),
    /没有执行该操作的权限/);
  await assert.rejects(removeProjectMember(project,owner,external,
    {idempotencyKey:randomUUID()}),/项目不存在或无权限/);
  const roles=(await listProjectMembers(project,candidate)).members;
  assert.equal(roles.find(x=>x.id===candidate)?.role,'owner');
  assert.equal(roles.find(x=>x.id===owner)?.role,'manager');

  const counts=(await pool.query<{receipts:number;events:number;audits:number}>(`
    SELECT
      (SELECT COUNT(*)::int FROM command_receipts WHERE project_id=$1) AS receipts,
      (SELECT COUNT(*)::int FROM domain_events WHERE project_id=$1) AS events,
      (SELECT COUNT(*)::int FROM audit_entries WHERE project_id=$1) AS audits
  `,[project])).rows[0];
  assert.equal(counts.receipts,5,'Only five independent commands succeeded');
  assert.equal(counts.events,counts.receipts);
  assert.equal(counts.audits,counts.receipts);

  // A removed tenant member never gets back access via residual project role.
  await pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2",
    [tenant,owner]);
  await assert.rejects(listProjectMembers(project,owner),/项目不存在或无权限/);
  console.log('Project governance Core: five obligations, transfer, roles, revocation, receipts');
}finally{
  await pool.end();
}
