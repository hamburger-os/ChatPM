import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {
  createPmEntry,transitionPmIssue,createPmTaskDependency,
  reassignPmDeliverable,submitPmDeliverable,reviewPmDeliverable,
} from '../src/governance/pm-register-commands.ts';

const suffix=randomUUID();
let project:string|null=null;
try{
  async function user(name:string){
    return (await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'unused') RETURNING id`,
      [name+'-'+suffix+'@example.test',name])).rows[0].id;
  }
  const owner=await user('pm-core-owner');
  const member=await user('pm-core-member');
  const observer=await user('pm-core-observer');
  const outsider=await user('pm-core-outsider');
  const tenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('PM Core commands') RETURNING id
  `)).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member'),($1,$4,'member')`,
    [tenant,owner,member,observer]);
  project=(await pool.query<{id:string}>(`
    INSERT INTO projects(tenant_id,name,owner_id)
    VALUES($1,'PM Core',$2) RETURNING id`,[tenant,owner])).rows[0].id;
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'owner'),($1,$3,'member'),($1,$4,'observer')`,
    [project,owner,member,observer]);

  const issuePayload={idempotencyKey:randomUUID(),title:'Supplier blocked',
    detail:'Delayed service',severity:'high',ownerId:null};
  const first=await createPmEntry(project,owner,'issues',issuePayload);
  assert.equal(first.item.status,'open');
  const replay=await createPmEntry(project,owner,'issues',issuePayload);
  assert.deepEqual(JSON.parse(JSON.stringify(replay)),
    JSON.parse(JSON.stringify(first)),
    'Same key must replay the same JSON response');
  await assert.rejects(createPmEntry(project,owner,'issues',{
    ...issuePayload,title:'Changed meaning',
  }),/幂等键已经用于其他命令/);
  await assert.rejects(createPmEntry(project,observer,'issues',{
    ...issuePayload,idempotencyKey:randomUUID(),
  }),/没有执行该操作的权限/);
  await assert.rejects(createPmEntry(project,outsider,'issues',{
    ...issuePayload,idempotencyKey:randomUUID(),
  }),/项目不存在或无权限/);

  const issueId=first.item.id as string;
  const transition={idempotencyKey:randomUUID(),
    expectedVersion:first.item.version as number,
    decision:'resolve' as const,note:'Human confirmed resolution'};
  await assert.rejects(transitionPmIssue(project,issueId,observer,transition),
    /没有执行该操作的权限/);
  const resolved=await transitionPmIssue(project,issueId,owner,transition);
  assert.equal(resolved.item.status,'resolved');
  assert.equal(resolved.item.version,2);
  assert.deepEqual(JSON.parse(JSON.stringify(
    await transitionPmIssue(project,issueId,owner,transition))),
    JSON.parse(JSON.stringify(resolved)));
  await assert.rejects(transitionPmIssue(project,issueId,owner,{
    ...transition,idempotencyKey:randomUUID(),
  }),/问题版本冲突/);
  const history=await pool.query<{count:number}>(`
    SELECT COUNT(*)::int AS count FROM project_issue_transitions
    WHERE project_id=$1 AND issue_id=$2`,[project,issueId]);
  assert.equal(history.rows[0].count,1);

  const deliverable=await createPmEntry(project,owner,'deliverables',{
    idempotencyKey:randomUUID(),title:'Release package',
    acceptanceCriteria:'Checksum verified',assigneeId:member,
    milestoneId:null,dueDate:null,
  });
  const deliverableId=deliverable.item.id as string;
  await assert.rejects(submitPmDeliverable(project,deliverableId,observer,{
    idempotencyKey:randomUUID(),expectedVersion:1,
  }),/只有交付物负责人可以提交验收|没有执行该操作的权限/);
  const submitted=await submitPmDeliverable(project,deliverableId,member,{
    idempotencyKey:randomUUID(),expectedVersion:1,
  });
  assert.equal(submitted.item.status,'submitted');
  await assert.rejects(reviewPmDeliverable(project,deliverableId,member,{
    idempotencyKey:randomUUID(),expectedVersion:2,decision:'accept',
  }),/没有执行该操作的权限/);
  const accepted=await reviewPmDeliverable(project,deliverableId,owner,{
    idempotencyKey:randomUUID(),expectedVersion:2,decision:'accept',
  });
  assert.equal(accepted.item.status,'accepted');
  await assert.rejects(reassignPmDeliverable(project,deliverableId,owner,{
    idempotencyKey:randomUUID(),expectedVersion:3,
    assigneeId:owner,note:'Cannot reassign accepted work',
  }),/已验收交付物不能重新指派/);

  const tasks=(await pool.query<{id:string}>(`
    INSERT INTO tasks(project_id,title) VALUES($1,'Execute'),($1,'Prepare')
    RETURNING id`,[project])).rows;
  const dependency={idempotencyKey:randomUUID(),
    dependentTaskId:tasks[0].id,prerequisiteTaskId:tasks[1].id};
  const added=await createPmTaskDependency(project,owner,dependency);
  assert.equal(added.dependency.dependent_task_id,tasks[0].id);
  assert.deepEqual(JSON.parse(JSON.stringify(
    await createPmTaskDependency(project,owner,dependency))),
    JSON.parse(JSON.stringify(added)));
  await assert.rejects(createPmTaskDependency(project,owner,{
    idempotencyKey:randomUUID(),
    dependentTaskId:tasks[1].id,prerequisiteTaskId:tasks[0].id,
  }),/任务依赖存在循环/);
  await assert.rejects(createPmTaskDependency(project,observer,{
    ...dependency,idempotencyKey:randomUUID(),
  }),/没有执行该操作的权限/);

  const counts=(await pool.query<{receipts:number;events:number;audits:number}>(`
    SELECT
      (SELECT COUNT(*)::int FROM command_receipts WHERE project_id=$1) AS receipts,
      (SELECT COUNT(*)::int FROM domain_events WHERE project_id=$1) AS events,
      (SELECT COUNT(*)::int FROM audit_entries WHERE project_id=$1) AS audits
  `,[project])).rows[0];
  assert.equal(counts.receipts,6,'Only six successful unique commands');
  assert.equal(counts.events,counts.receipts,'Each command has one event');
  assert.equal(counts.audits,counts.receipts,'Each command has one audit record');
  console.log('PM Core commands: authorization, reviews, idempotency and event audit');
}finally{
  if(project)await pool.query(`
    UPDATE outbox_events SET processed_at=NOW(),claimed_at=NULL,claim_token=NULL
    WHERE project_id=$1 AND processed_at IS NULL AND dead_at IS NULL`,[project]);
  await pool.end();
}
