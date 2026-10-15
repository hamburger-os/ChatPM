import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {createTask,updateTask,hasTaskChanges} from '../src/delivery/task-commands.ts';

assert.equal(hasTaskChanges({
  version:1,status:'todo',title:'Same',
  assignee_id:null,due_date:null,
},{
  status:'todo',title:'Same',assigneeId:null,dueDate:null,
}),false);
assert.equal(hasTaskChanges({
  version:1,status:'todo',title:'Same',
  assignee_id:null,due_date:null,
},{
  status:'doing',title:'Same',assigneeId:null,dueDate:null,
}),true);

const suffix=randomUUID();
try{
  const uid=(await pool.query<{id:string}>(`
    INSERT INTO users(email,display_name,password_hash)
    VALUES($1,'Task command owner','unused') RETURNING id`,
    ['task-no-op-'+suffix+'@example.test'])).rows[0].id;
  const tenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Task command tests') RETURNING id`)).rows[0].id;
  await pool.query("INSERT INTO tenant_members(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [tenant,uid]);
  const pid=(await pool.query<{id:string}>(`
    INSERT INTO projects(tenant_id,name,owner_id)
    VALUES($1,'Task command integration',$2) RETURNING id`,[tenant,uid])).rows[0].id;
  await pool.query("INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'owner')",
    [pid,uid]);

  const created=await createTask(pid,uid,{
    idempotencyKey:randomUUID(),title:'Clean Task',detail:'No artificial events',
    assigneeId:uid,dueDate:'2026-11-19',
  });
  const taskId=created.task.id;
  assert.equal(created.task.version,1);
  const revision=(await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM project_task_history WHERE task_id=$1`,
    [taskId])).rows[0].n;
  const initialAudit=(await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM audit_entries
    WHERE project_id=$1 AND target_id=$2`,[pid,taskId])).rows[0].n;
  const initialEvents=(await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM domain_events
    WHERE project_id=$1 AND aggregate_type='tasks' AND aggregate_id=$2`,
    [pid,taskId])).rows[0].n;
  const initialOutbox=(await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM outbox_events
    WHERE project_id=$1 AND kind='domain.changed'`,[pid])).rows[0].n;

  const noChange={idempotencyKey:randomUUID(),version:1,
    title:'Clean Task',status:'todo' as const,
    assigneeId:uid,dueDate:'2026-11-19'};
  await assert.rejects(updateTask(pid,taskId,uid,noChange),
    /任务没有实际变化/);
  const snapshot=await pool.query<{version:number}>(`
    SELECT version FROM tasks WHERE id=$1`,[taskId]);
  assert.equal(snapshot.rows[0].version,1);
  assert.equal((await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM project_task_history WHERE task_id=$1`,
    [taskId])).rows[0].n,revision,
    'No-op request must not fabricate a Task history event');
  assert.equal((await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM audit_entries
    WHERE project_id=$1 AND target_id=$2`,[pid,taskId])).rows[0].n,initialAudit);
  assert.equal((await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM domain_events
    WHERE project_id=$1 AND aggregate_type='tasks' AND aggregate_id=$2`,
    [pid,taskId])).rows[0].n,initialEvents);
  assert.equal((await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM outbox_events
    WHERE project_id=$1 AND kind='domain.changed'`,[pid])).rows[0].n,initialOutbox);

  const changed=await updateTask(pid,taskId,uid,{
    ...noChange,idempotencyKey:randomUUID(),status:'doing',
  });
  assert.equal(changed.task.version,2);
  const replay=await updateTask(pid,taskId,uid,{
    ...noChange,idempotencyKey:'70eb3c6f-674e-4b1f-a56d-e54b1ca37d29',status:'blocked',version:2,
  });
  assert.equal(replay.task.version,3);
  const sameKey=await updateTask(pid,taskId,uid,{
    ...noChange,idempotencyKey:'70eb3c6f-674e-4b1f-a56d-e54b1ca37d29',status:'blocked',version:2,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(sameKey)),
    JSON.parse(JSON.stringify(replay)),
    'Idempotent receipts must preserve the same serialized Task values');
  await assert.rejects(updateTask(pid,taskId,uid,{
    ...noChange,idempotencyKey:'70eb3c6f-674e-4b1f-a56d-e54b1ca37d29',
    status:'done',version:2,
  }),/幂等键/);
  await assert.rejects(updateTask(pid,taskId,uid,{
    ...noChange,idempotencyKey:randomUUID(),status:'blocked',version:2,
  }),/任务版本已更新/);
  assert.equal((await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM domain_events
    WHERE project_id=$1 AND aggregate_type='tasks' AND aggregate_id=$2`,
    [pid,taskId])).rows[0].n,initialEvents+2);
  console.log('Task Core commands: no-op rollback, real task changes, status, receipt replay');
}finally{await pool.end();}
