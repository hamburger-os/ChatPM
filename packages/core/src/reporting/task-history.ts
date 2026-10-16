import { transaction, type DbClient } from '../db.ts';
import { lockProjectAccess } from '../identity/project-access.ts';

type Cursor={beforeAt?:string;beforeId?:string};
export type TaskHistoryEntry={
  id:string;task_id:string;project_id:string;task_version:number;
  kind:'created'|'updated';before_status:string|null;after_status:string;
  before_title:string|null;after_title:string;
  before_due_date:string|null;after_due_date:string|null;
  before_assignee_id:string|null;after_assignee_id:string|null;
  before_archived_at:string|null;after_archived_at:string|null;
  changed_at:string;
};

function missing():never{
  throw Object.assign(new Error('任务不存在或无权访问其历史'),{statusCode:404});
}
async function authorize(db:DbClient,projectId:string,taskId:string,actorId:string){
  await lockProjectAccess(db,projectId,actorId);
  const task=await db.query(
    'SELECT 1 FROM tasks WHERE project_id=$1 AND id=$2 FOR KEY SHARE',
    [projectId,taskId]);
  if(!task.rowCount)missing();
}
const fields=`id,project_id,task_id,task_version,kind,before_status,after_status,
  before_title,after_title,before_due_date::text AS before_due_date,
  after_due_date::text AS after_due_date,before_assignee_id,
  after_assignee_id,before_archived_at,after_archived_at,changed_at`;

export async function listTaskHistory(projectId:string,taskId:string,
  actorId:string,cursor:Cursor){
  return transaction(async db=>{
    await authorize(db,projectId,taskId,actorId);
    const {rows}=await db.query<TaskHistoryEntry>(`SELECT ${fields}
      FROM project_task_history WHERE project_id=$1 AND task_id=$2
        AND ($3::timestamptz IS NULL OR
          (changed_at,id)<($3::timestamptz,$4::uuid))
      ORDER BY changed_at DESC,id DESC LIMIT 51`,
    [projectId,taskId,cursor.beforeAt??null,cursor.beforeId??null]);
    return {history:rows.slice(0,50),nextCursor:rows.length>50?
      {beforeAt:rows[49].changed_at,beforeId:rows[49].id}:null};
  });
}
export async function getTaskHistoryEntry(projectId:string,taskId:string,
  eventId:string,actorId:string){
  return transaction(async db=>{
    await authorize(db,projectId,taskId,actorId);
    const row=(await db.query<TaskHistoryEntry>(`SELECT ${fields}
      FROM project_task_history WHERE project_id=$1 AND task_id=$2 AND id=$3`,
      [projectId,taskId,eventId])).rows[0];
    if(!row)missing();
    return {event:row};
  });
}
