import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {setTaskArchived,updateTask} from '../src/delivery/task-commands.ts';
import {listTaskHistory} from '../src/reporting/task-history.ts';
import {listProjectTasks} from '../src/delivery/task-queries.ts';

const suffix=randomUUID();
let projectId:string|null=null;
try{
  async function user(label:string){
    return (await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'unused') RETURNING id`,
    [label+'-'+suffix+'@example.test',label])).rows[0].id;
  }
  const owner=await user('archive-owner');
  const manager=await user('archive-manager');
  const member=await user('archive-member');
  const observer=await user('archive-observer');
  const outsider=await user('archive-outsider');
  const tenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Task archive test') RETURNING id`)).rows[0].id;
  const otherTenant=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Task archive outsider') RETURNING id`)).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member'),($1,$4,'member'),
      ($1,$5,'member'),($6,$7,'admin')`,
    [tenant,owner,manager,member,observer,otherTenant,outsider]);
  const pid=(await pool.query<{id:string}>(`
    INSERT INTO projects(tenant_id,name,owner_id)
    VALUES($1,'Archive registry',$2) RETURNING id`,[tenant,owner])).rows[0].id;
  projectId=pid;
  const otherProject=(await pool.query<{id:string}>(`
    INSERT INTO projects(tenant_id,name,owner_id)
    VALUES($1,'Unrelated registry',$2) RETURNING id`,
    [otherTenant,outsider])).rows[0].id;
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'owner'),($1,$3,'manager'),($1,$4,'member'),
      ($1,$5,'observer'),($6,$7,'owner')`,
    [pid,owner,manager,member,observer,otherProject,outsider]);
  async function makeTask(status:'todo'|'done'|'cancelled'){
    return (await pool.query<{id:string}>(`
      INSERT INTO tasks(project_id,title,status,assignee_id)
      VALUES($1,$2,$3,$4) RETURNING id`,
      [pid,'Archive '+status+' '+randomUUID(),status,member])).rows[0].id;
  }
  const active=await makeTask('todo');
  const taskId=await makeTask('done');
  const pendingTask=await makeTask('cancelled');
  const input={idempotencyKey:randomUUID(),expectedVersion:1};
  await assert.rejects(setTaskArchived(pid,active,manager,input,true),
    /只有已完成或已取消的任务才能归档/);
  await assert.rejects(setTaskArchived(pid,taskId,member,input,true),
    /没有执行该操作的权限/);
  await assert.rejects(setTaskArchived(pid,taskId,observer,input,true),
    /没有执行该操作的权限/);
  await assert.rejects(setTaskArchived(pid,taskId,outsider,input,true),
    /项目不存在或无权限/);
  await assert.rejects(setTaskArchived(otherProject,taskId,outsider,input,true),
    /任务不存在/);
  await assert.rejects(setTaskArchived(pid,taskId,manager,{
    ...input,expectedVersion:999,
  },true),/任务版本已更新/);

  const msg=(await pool.query<{id:string}>(`
    INSERT INTO messages(project_id,author_id,kind,content,client_nonce)
    VALUES($1,$2,'user','Pending progress',$3) RETURNING id`,
    [pid,owner,randomUUID()])).rows[0].id;
  await pool.query(`
    INSERT INTO task_progress_updates(project_id,task_id,source_message_id,
      summary,kind,model_name,prompt_version)
    VALUES($1,$2,$3,'Needs a review','progress','mock','test')`,
    [pid,pendingTask,msg]);
  await assert.rejects(setTaskArchived(pid,pendingTask,manager,{
    idempotencyKey:randomUUID(),expectedVersion:1,
  },true),/仍有待审核的进度证据/);

  const beforeHistory=await listTaskHistory(pid,taskId,observer,{});
  const first=await setTaskArchived(pid,taskId,manager,input,true);
  assert.equal(first.task.version,2);
  assert.ok(first.task.archived_at);
  const replay=await setTaskArchived(pid,taskId,manager,input,true);
  assert.deepEqual(JSON.parse(JSON.stringify(replay)),
    JSON.parse(JSON.stringify(first)));
  await assert.rejects(setTaskArchived(pid,taskId,manager,{
    ...input,expectedVersion:2,
  },true),/幂等键/);
  await assert.rejects(setTaskArchived(pid,taskId,manager,{
    idempotencyKey:randomUUID(),expectedVersion:1,
  },true),/任务版本已更新/);
  await assert.rejects(updateTask(pid,taskId,manager,{
    idempotencyKey:randomUUID(),version:2,status:'todo',
  }),/任务已归档/);
  assert.equal((await listProjectTasks(pid,manager,false)).tasks
    .some(t=>t.id===taskId),false);
  assert.equal((await listProjectTasks(pid,observer,true)).tasks
    .some(t=>t.id===taskId),true);
  await assert.rejects(listProjectTasks(pid,outsider,true),
    /项目不存在或无权限/);
  await assert.rejects(listProjectTasks(otherProject,owner,true),
    /项目不存在或无权限/);
  assert.equal((await pool.query<{n:number}>(`
    SELECT count(*)::int AS n FROM tasks WHERE id=$1 AND archived_at IS NOT NULL`,
    [taskId])).rows[0].n,1);
  assert.equal((await pool.query<{n:number}>(`
    SELECT count(*)::int AS n FROM followup_plans WHERE task_id=$1 AND active`,
    [taskId])).rows[0].n,0);
  const archivedHistory=await listTaskHistory(pid,taskId,observer,{});
  assert.equal(archivedHistory.history.length,beforeHistory.history.length+1);
  assert.equal(archivedHistory.history[0].task_version,2);
  assert.ok(archivedHistory.history[0].after_archived_at);
  assert.equal(archivedHistory.history[0].before_archived_at,null);
  const restored=await setTaskArchived(pid,taskId,owner,{
    idempotencyKey:randomUUID(),expectedVersion:2,
  },false);
  assert.equal(restored.task.version,3);
  assert.equal(restored.task.archived_at,null);
  const finalHistory=await listTaskHistory(pid,taskId,member,{});
  assert.equal(finalHistory.history.length,beforeHistory.history.length+2);
  assert.ok(finalHistory.history[0].before_archived_at);
  assert.equal(finalHistory.history[0].after_archived_at,null);
  for(const kind of ['task.archived.v1','task.restored.v1']){
    const events=(await pool.query<{n:number}>(`
      SELECT count(*)::int AS n FROM domain_events
      WHERE project_id=$1 AND kind=$2 AND aggregate_id=$3`,
      [pid,kind,taskId])).rows[0].n;
    const audits=(await pool.query<{n:number}>(`
      SELECT count(*)::int AS n FROM audit_entries
      WHERE project_id=$1 AND action=$2 AND target_id=$3`,
      [pid,kind,taskId])).rows[0].n;
    assert.equal(events,1);
    assert.equal(audits,1);
  }
  await assert.rejects(setTaskArchived(pid,taskId,owner,{
    idempotencyKey:randomUUID(),expectedVersion:3,
  },false),/任务未归档/);
  await pool.query('DELETE FROM project_members WHERE project_id=$1 AND user_id=$2',
    [pid,observer]);
  await assert.rejects(listProjectTasks(pid,observer,true),
    /项目不存在或无权限/);

  console.log('Task archive Core: permission, version, pending review, immutable evidence, restore');
} finally {
  if(projectId)await pool.query(`
    UPDATE outbox_events SET processed_at=NOW()
    WHERE project_id=$1 AND processed_at IS NULL AND dead_at IS NULL
  `,[projectId]);
  await pool.end();
}
