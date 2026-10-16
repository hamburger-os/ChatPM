import { assertProject } from '../permissions.ts';
import type { DbClient } from '../db.ts';
import { executePmCommand } from '../pm-command.ts';
import { ensureTaskAssignee } from './task-assignee.ts';
import { lockTaskDependencyGraph,assertPrerequisitesCompleted } from './dependency-policy.ts';
import { syncFollowup } from '../followup.ts';

type TaskStatus='todo'|'doing'|'blocked'|'done'|'cancelled';
export type CreateTaskInput={
  idempotencyKey:string;title:string;detail:string;
  assigneeId:string|null;dueDate:string|null;
};
export type UpdateTaskInput={
  idempotencyKey:string;version:number;status?:TaskStatus;
  title?:string;assigneeId?:string|null;dueDate?:string|null;
};
function fail(statusCode:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode});
}

/** The Delivery module is the sole writer of newly created Task rows.
 * A parent approval command may call this within its existing transaction:
 * it must not open a second receipt, transaction or independent approval.
 */
export async function createTaskRecord(db:DbClient,projectId:string,input:{
  title:string;detail:string;assigneeId:string|null;
  dueDate?:string|null;sourceDueAt?:Date|null;sourceProposalId?:string|null;
}):Promise<{id:string;version:number}>{
  if(input.assigneeId)await ensureTaskAssignee(db,projectId,input.assigneeId);
  const {rows}=await db.query(`
    INSERT INTO tasks(project_id,title,detail,assignee_id,due_date,source_proposal_id)
    VALUES($1,$2,$3,$4,
      CASE WHEN $5::boolean THEN $6::date
           ELSE ($7::timestamptz AT TIME ZONE
             (SELECT timezone FROM projects WHERE id=$1))::date END,$8)
    RETURNING *
  `,[projectId,input.title,input.detail,input.assigneeId,
    input.dueDate!==undefined,input.dueDate??null,
    input.sourceDueAt??null,input.sourceProposalId??null]);
  const task=rows[0] as {id:string;version:number};
  await syncFollowup(db,projectId,task.id);
  return task;
}

/** Official Task writes share PM receipts, domain events, audit and outbox. */
export async function createTask(
  projectId:string,actorId:string,v:CreateTaskInput,
){
  return executePmCommand({
    projectId,actorId,action:'task.create',
    kind:'task.created.v1',idempotencyKey:v.idempotencyKey,payload:v,
    mutate:async db=>{
      const task=await createTaskRecord(db,projectId,v);
      return {response:{task},aggregateType:'tasks',aggregateId:task.id,
        aggregateVersion:task.version};
    },
  });
}
type TaskBefore={
  version:number;status:TaskStatus;title:string;assignee_id:string|null;
  due_date:string|null;archived_at?:Date|null;
};
export function hasTaskChanges(before:TaskBefore,next:{
  status:TaskStatus;title:string;assigneeId:string|null;dueDate:string|null;
}):boolean{
  return before.status!==next.status||before.title!==next.title||
    before.assignee_id!==next.assigneeId||before.due_date!==next.dueDate;
}

/**
 * Only a meaningful Task change creates a new version, immutable history,
 * command receipt, domain event, audit entry and downstream outbox message.
 * Same-key replays still return the old result before entering mutate().
 */
export async function updateTask(
  projectId:string,taskId:string,actorId:string,v:UpdateTaskInput,
){
  const metadata=v.title!==undefined||v.assigneeId!==undefined||
    v.dueDate!==undefined;
  return executePmCommand({
    projectId,actorId,action:'read',
    kind:'task.updated.v1',idempotencyKey:v.idempotencyKey,
    payload:{taskId,...v},
    mutate:async(db,role)=>{
      if(metadata)assertProject(role,'task.plan');
      // Graph lock must precede task row lock; no dependency/write inversion.
      if(v.status==='done')await lockTaskDependencyGraph(db,projectId);
      const {rows}=await db.query(`
        SELECT *,due_date::text AS due_date FROM tasks
        WHERE project_id=$1 AND id=$2 FOR UPDATE
      `,[projectId,taskId]);
      const before=rows[0] as TaskBefore|undefined;
      if(!before)fail(404,'任务不存在');
      if(before.archived_at)fail(409,'任务已归档，请先恢复后再修改');
      if(v.status!==undefined)assertProject(role,'task.status',{
        isAssignee:before.assignee_id===actorId});
      if(before.version!==v.version)fail(409,'任务版本已更新，请刷新');
      if(role==='member')await ensureTaskAssignee(db,projectId,actorId);
      const next={
        status:v.status??before.status,
        title:v.title??before.title,
        assigneeId:v.assigneeId===undefined?before.assignee_id:v.assigneeId,
        dueDate:v.dueDate===undefined?before.due_date:v.dueDate,
      };
      if(!hasTaskChanges(before,next))
        fail(409,'任务没有实际变化，不需要重复修改');
      if(v.status==='done'&&before.status!=='done')
        await assertPrerequisitesCompleted(db,projectId,taskId);
      // Historical completed Tasks may retain revoked users; active work may not.
      if(next.assigneeId&&!['done','cancelled'].includes(next.status))
        await ensureTaskAssignee(db,projectId,next.assigneeId);
      const saved=await db.query(`
        UPDATE tasks SET status=$3,title=$4,assignee_id=$5,due_date=$6,
          version=version+1,updated_at=NOW()
        WHERE project_id=$1 AND id=$2 RETURNING *
      `,[projectId,taskId,next.status,next.title,next.assigneeId,next.dueDate]);
      const task=saved.rows[0] as {id:string;version:number};
      await syncFollowup(db,projectId,taskId);
      return {
        response:{task},aggregateType:'tasks',aggregateId:taskId,
        aggregateVersion:task.version,
        auditDetails:{before:{status:before.status,title:before.title,
          assigneeId:before.assignee_id,dueDate:before.due_date},
          after:next},
      };
    },
  });
}

export type TaskArchiveInput={idempotencyKey:string;expectedVersion:number};

/** Archive is not cancellation and never destroys immutable history.
 * Only finished/cancelled work with no pending human review may be archived.
 * Both actions require a live project planner role and an optimistic version.
 */
export async function setTaskArchived(
  projectId:string,taskId:string,actorId:string,
  input:TaskArchiveInput,archive:boolean,
){
  return executePmCommand({
    projectId,actorId,action:'task.plan',
    kind:archive?'task.archived.v1':'task.restored.v1',
    idempotencyKey:input.idempotencyKey,payload:{taskId,...input},
    mutate:async db=>{
      const before=(await db.query<{
        version:number;status:TaskStatus;archived_at:Date|null;
      }>(`SELECT version,status,archived_at FROM tasks
        WHERE project_id=$1 AND id=$2 FOR UPDATE`,
      [projectId,taskId])).rows[0];
      if(!before)fail(404,'任务不存在');
      if(before.version!==input.expectedVersion)
        fail(409,'任务版本已更新，请刷新');
      if(archive){
        if(before.archived_at)fail(409,'任务已经归档');
        if(!['done','cancelled'].includes(before.status))
          fail(409,'只有已完成或已取消的任务才能归档');
        const pending=await db.query(`
          SELECT 1 FROM task_progress_updates
          WHERE project_id=$1 AND task_id=$2 AND status='pending' LIMIT 1`,
          [projectId,taskId]);
        if(pending.rowCount)fail(409,'仍有待审核的进度证据，请先完成审核');
      }else if(!before.archived_at)fail(409,'任务未归档');
      const {rows}=await db.query<{id:string;version:number;archived_at:Date|null}>(`
        UPDATE tasks SET
          archived_at=CASE WHEN $3::boolean THEN NOW() ELSE NULL END,
          archived_by=CASE WHEN $3::boolean THEN $4::uuid ELSE NULL END,
          version=version+1,updated_at=NOW()
        WHERE project_id=$1 AND id=$2 RETURNING id,version,archived_at`,
      [projectId,taskId,archive,actorId]);
      await syncFollowup(db,projectId,taskId);
      return {response:{task:rows[0]},
        aggregateType:'tasks',aggregateId:taskId,
        aggregateVersion:rows[0].version,
        auditDetails:{previousVersion:before.version,archived:archive,
          previousArchivedAt:before.archived_at?.toISOString()??null,
          newArchivedAt:rows[0].archived_at?.toISOString()??null}};
    },
  });
}
