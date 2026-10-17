import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.ts';
import { lockProjectAccess } from '../src/identity/project-access.ts';
import { assertPrerequisitesCompleted, lockTaskDependencyGraph } from '../src/delivery/dependency-policy.ts';
import { assertProject } from '../src/permissions.ts';
import { postUserMessage } from '../src/conversation/user-message-command.ts';

const marker=randomUUID();
const {rows:users}=await pool.query(
  "INSERT INTO users(email,display_name,password_hash) VALUES($1,'Role Lock Test','unused') RETURNING id",
  ['role-lock-'+marker+'@example.com']);
const {rows:tenants}=await pool.query(
  "INSERT INTO tenants(name) VALUES('Role locking test') RETURNING id");
const actorId=users[0].id as string,tenantId=tenants[0].id as string;
// Keep an actual owner while the test exercises a manager being promoted.
const seedOwner=(await pool.query<{id:string}>(
  "INSERT INTO users(email,display_name,password_hash) VALUES($1,'Role owner','unused') RETURNING id",
  ['role-owner-'+marker+'@example.com'])).rows[0].id;
const {rows:projects}=await pool.query(`
  WITH created AS (
    INSERT INTO projects(tenant_id,name)
    VALUES($1,'Role lock test') RETURNING id
  ), seeded_owner AS (
    INSERT INTO project_members(project_id,user_id,role)
    SELECT id,$2,'owner' FROM created RETURNING project_id
  )
  SELECT id FROM created`,[tenantId,seedOwner]);
const projectId=projects[0].id as string;
await pool.query(
  "INSERT INTO tenant_members(tenant_id,user_id,role) VALUES($1,$2,'admin')",
  [tenantId,actorId]);
await pool.query(
  "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'manager')",
  [projectId,actorId]);

const a=await pool.connect(),b=await pool.connect();
try{
  await a.query('BEGIN');
  const previous=await lockProjectAccess(a,projectId,actorId);
  assert.deepEqual(previous,{tenantId,role:'manager'});
  assertProject(previous.role,'task.create');

  await b.query('BEGIN');
  await b.query("SET LOCAL lock_timeout='150ms'");
  await assert.rejects(
    b.query("UPDATE project_members SET role='observer' WHERE project_id=$1 AND user_id=$2",
      [projectId,actorId]),
    (e:unknown)=>(e as {code?:string}).code==='55P03',
    'Revoking a role must wait for an ongoing authorized transaction');
  await b.query('ROLLBACK');
  await a.query('COMMIT');

  // The HTTP-facing message command locks membership and publishes atomically.
  const nonce=randomUUID();
  const first=await postUserMessage(projectId,actorId,'项目更新',nonce);
  const replay=await postUserMessage(projectId,actorId,'项目更新',nonce);
  assert.equal(replay.message.id,first.message.id);
  await assert.rejects(
    postUserMessage(projectId,actorId,'修改后的文本',nonce),
    /消息幂等键冲突/);
  const {rows:published}=await pool.query(
    "SELECT COUNT(*)::int AS count FROM outbox_events WHERE project_id=$1 AND kind='message.created'",
    [projectId]);
  assert.equal(published[0].count,1,'Replay must not create another outbox event');
  const {rows:audited}=await pool.query(
    "SELECT COUNT(*)::int AS count FROM audit_entries WHERE project_id=$1 AND action='message.created'",
    [projectId]);
  assert.equal(audited[0].count,1,'Message and audit commit only once');
  // Keep this integration fixture out of the later global Outbox leasing test.
  await pool.query("DELETE FROM outbox_events WHERE project_id=$1 AND kind='message.created'",
    [projectId]);

  await b.query("UPDATE project_members SET role='observer' WHERE project_id=$1 AND user_id=$2",
    [projectId,actorId]);
  await a.query('BEGIN');
  const current=await lockProjectAccess(a,projectId,actorId);
  assert.equal(current.role,'observer');
  assert.throws(()=>assertProject(current.role,'task.create'),/没有执行该操作的权限/);
  await a.query('COMMIT');
  await assert.rejects(postUserMessage(projectId,actorId,'越权发送',randomUUID()),
    /没有执行该操作的权限/);

  // Owner-only operations must never rely on a stale manager/observer role.
  for(const action of ['members.manage','report.manage','settings.manage',
    'operations.manage'] as const)
    assert.throws(()=>assertProject(current.role,action),/没有执行该操作的权限/);
  // Transfer authority atomically; the partial unique index and deferred
  // exactly-one-owner constraint forbid a committed gap or two owners.
  await b.query('BEGIN');
  await b.query("UPDATE project_members SET role='manager' WHERE project_id=$1 AND user_id=$2",
    [projectId,seedOwner]);
  await b.query("UPDATE project_members SET role='owner' WHERE project_id=$1 AND user_id=$2",
    [projectId,actorId]);
  await b.query('COMMIT');
  await a.query('BEGIN');
  const ownerAccess=await lockProjectAccess(a,projectId,actorId);
  assert.equal(ownerAccess.role,'owner');
  for(const action of ['members.manage','report.manage','settings.manage',
    'operations.manage'] as const)assertProject(ownerAccess.role,action);
  await b.query('BEGIN');
  await b.query("SET LOCAL lock_timeout='150ms'");
  await assert.rejects(
    b.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2",
      [tenantId,actorId]),
    (error:unknown)=>(error as {code?:string}).code==='55P03',
    'Removing organization membership must wait while an owner write is authorized');
  await b.query('ROLLBACK');
  await a.query('COMMIT');

  const {rows:tasks}=await pool.query(`
    INSERT INTO tasks(project_id,title,status)
    VALUES($1,'Prerequisite','done'),($1,'Dependent','todo') RETURNING id,title
  `,[projectId]);
  const prerequisite=tasks.find(t=>t.title==='Prerequisite')!.id as string;
  const dependent=tasks.find(t=>t.title==='Dependent')!.id as string;
  await pool.query(`
    INSERT INTO task_dependencies(project_id,dependent_task_id,prerequisite_task_id,created_by)
    VALUES($1,$2,$3,$4)
  `,[projectId,dependent,prerequisite,actorId]);
  await a.query('BEGIN');
  await lockTaskDependencyGraph(a,projectId);
  await assertPrerequisitesCompleted(a,projectId,dependent);

  await b.query('BEGIN');
  await b.query("SET LOCAL lock_timeout='150ms'");
  await assert.rejects(
    b.query("UPDATE tasks SET status='doing' WHERE id=$1 AND project_id=$2",
      [prerequisite,projectId]),
    (e:unknown)=>(e as {code?:string}).code==='55P03',
    'Reopening a completed prerequisite must wait for the dependent completion');
  await b.query('ROLLBACK');
  await a.query('COMMIT');
  await pool.query("UPDATE tasks SET status='doing' WHERE id=$1",[prerequisite]);
  await a.query('BEGIN');
  await lockTaskDependencyGraph(a,projectId);
  await assert.rejects(assertPrerequisitesCompleted(a,projectId,dependent),
    /存在未完成的前置任务/);
  await a.query('ROLLBACK');

  // An organization revocation is checked independently of project role.
  await pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2",
    [tenantId,actorId]);
  await assert.rejects(lockProjectAccess(a,projectId,actorId),
    /项目不存在或无权限/);
  await assert.rejects(postUserMessage(projectId,actorId,'失效成员',randomUUID()),
    /项目不存在或无权限/);
  console.log('Transaction-scoped role and tenant revocation integration passed');
}finally{
  try{await a.query('ROLLBACK');}catch{}
  try{await b.query('ROLLBACK');}catch{}
  a.release();b.release();
  await pool.end();
}
