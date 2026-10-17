import {pool} from './db.ts';
import {withProjectRead} from './identity/project-access.ts';

/** Project details and owner-only AI audit reads share their authorization snapshot. */
export function getProjectDetails(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'read',async db=>{
    const {rows}=await db.query(`
      SELECT p.id,p.name,p.timezone,p.ai_enabled,p.work_start,p.work_end,
        p.cooldown_hours,p.settings_revision,owner.user_id AS owner_id,
        p.ownership_revision
      FROM projects p
      JOIN project_members owner
        ON owner.project_id=p.id AND owner.role='owner'
      WHERE p.id=$1`,[projectId]);
    return {project:rows[0]};
  });
}
export function getProjectAiAuthorization(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'ai.audit.read',async db=>{
    const {rows}=await db.query<{enabled:boolean;version:string}>(`
      SELECT ai_enabled AS enabled,ai_authorization_version AS version
      FROM projects WHERE id=$1`,[projectId]);
    return {authorization:{enabled:rows[0].enabled,version:Number(rows[0].version)}};
  });
}
export function listProjectAiInvocations(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'ai.audit.read',async db=>{
    const {rows}=await db.query(`
      SELECT id,authorization_version,model_identity,prompt_version,status,
        error_code,latency_ms,input_tokens,output_tokens,started_at,finished_at
      FROM ai_model_invocations WHERE project_id=$1
      ORDER BY started_at DESC LIMIT 60`,[projectId]);
    return {invocations:rows};
  });
}
export function listProjectAiRuns(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'ai.audit.read',async db=>{
    const {rows}=await db.query(`
      SELECT source_message_id,kind,status,model_name,error_code,
        created_at,updated_at FROM ai_analysis_runs WHERE project_id=$1
      ORDER BY created_at DESC LIMIT 40`,[projectId]);
    return {runs:rows};
  });
}

/** The membership and tenant joins are the sole visibility rule for a
 * user's project navigation. A single SQL snapshot prevents split checks.
 */
export async function listMemberProjects(actorId:string){
  const {rows}=await pool.query(`
    SELECT p.id,p.name,p.timezone,p.ai_enabled,p.work_start,p.work_end,
      p.cooldown_hours,p.settings_revision,owner.user_id AS owner_id,p.ownership_revision,pm.role
    FROM projects p
    JOIN project_members pm ON pm.project_id=p.id
    JOIN project_members owner ON owner.project_id=p.id AND owner.role='owner'
    JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
    WHERE pm.user_id=$1 ORDER BY p.created_at DESC
  `,[actorId]);
  return {projects:rows};
}
