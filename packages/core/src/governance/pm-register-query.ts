import {withProjectRead} from '../identity/project-access.ts';

// Only these in-process constants may become SQL identifiers.
const registers={
  goals:'project_goals',
  milestones:'project_milestones',
  deliverables:'project_deliverables',
  issues:'project_issues',
  decisions:'project_decisions',
  changes:'project_change_requests',
} as const;

const maxHistoryVersion=2147483647;
function validateHistoryCursor(version:number|undefined){
  if(version!==undefined&&(!Number.isInteger(version)||
    version<1||version>maxHistoryVersion))
    throw Object.assign(new Error('历史版本游标不合法'),{statusCode:400});
}
function missing(message:string):never{
  throw Object.assign(new Error(message),{statusCode:404});
}

/** One current-authorized snapshot for all official PM registers. */
export function listPmRegisters(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'read',async db=>{
    const result:Record<string,unknown[]>={};
    for(const [name,table] of Object.entries(registers)){
      const order=table==='project_decisions'?'decided_at':'created_at';
      const {rows}=await db.query(
        `SELECT * FROM ${table} WHERE project_id=$1 ORDER BY ${order} DESC LIMIT 100`,
        [projectId]);
      result[name]=rows;
    }
    return result;
  });
}

/** Historical read and entity existence share the locked membership snapshot. */
export function readPmIssueHistory(
  projectId:string,issueId:string,actorId:string,beforeVersion?:number,
){
  validateHistoryCursor(beforeVersion);
  return withProjectRead(projectId,actorId,'read',async db=>{
    const exists=await db.query(
      'SELECT 1 FROM project_issues WHERE project_id=$1 AND id=$2',
      [projectId,issueId]);
    if(!exists.rowCount)missing('问题不存在或无权限');
    const {rows}=await db.query<{
      id:string;from_status:string;to_status:string;issue_version:number;
      note:string;actor_id:string;occurred_at:Date;
    }>(`
      SELECT id,from_status,to_status,issue_version,note,actor_id,occurred_at
      FROM project_issue_transitions
      WHERE project_id=$1 AND issue_id=$2
        AND issue_version<COALESCE($3::int,2147483647)
      ORDER BY issue_version DESC LIMIT 51
    `,[projectId,issueId,beforeVersion??null]);
    return {history:rows.slice(0,50),
      nextBeforeVersion:rows.length>50?rows[49].issue_version:null};
  });
}

export function readPmChangeImplementationHistory(
  projectId:string,changeId:string,actorId:string,beforeVersion?:number,
){
  validateHistoryCursor(beforeVersion);
  return withProjectRead(projectId,actorId,'read',async db=>{
    const exists=await db.query(
      'SELECT 1 FROM project_change_requests WHERE project_id=$1 AND id=$2',
      [projectId,changeId]);
    if(!exists.rowCount)missing('变更申请不存在或无权限');
    const {rows}=await db.query<{
      id:string;change_version:number;from_status:string;to_status:string;
      action:string;note:string;actor_id:string;
      evidence_message_id:string|null;occurred_at:Date;
    }>(`
      SELECT id,change_version,from_status,to_status,action,note,
        actor_id,evidence_message_id,occurred_at
      FROM project_change_implementation_history
      WHERE project_id=$1 AND change_id=$2
        AND change_version<COALESCE($3::int,2147483647)
      ORDER BY change_version DESC LIMIT 51
    `,[projectId,changeId,beforeVersion??null]);
    return {history:rows.slice(0,50),
      nextBeforeVersion:rows.length>50?rows[49].change_version:null};
  });
}

export function listPmTaskDependencies(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'read',async db=>{
    const {rows}=await db.query(`
      SELECT * FROM task_dependencies
      WHERE project_id=$1 ORDER BY created_at DESC LIMIT 250
    `,[projectId]);
    return {dependencies:rows};
  });
}
