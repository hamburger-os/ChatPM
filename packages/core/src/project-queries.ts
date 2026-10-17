import {withProjectRead} from './identity/project-access.ts';

/** Project details and owner-only AI audit reads share their authorization snapshot. */
export function getProjectDetails(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'read',async db=>{
    const {rows}=await db.query(`
      SELECT id,name,timezone,ai_enabled,work_start,work_end,cooldown_hours,
        settings_revision,owner_id,ownership_revision
      FROM projects WHERE id=$1`,[projectId]);
    return {project:rows[0]};
  });
}
export function getProjectAiAuthorization(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'members.manage',async db=>{
    const {rows}=await db.query<{enabled:boolean;version:string}>(`
      SELECT ai_enabled AS enabled,ai_authorization_version AS version
      FROM projects WHERE id=$1`,[projectId]);
    return {authorization:{enabled:rows[0].enabled,version:Number(rows[0].version)}};
  });
}
export function listProjectAiInvocations(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'members.manage',async db=>{
    const {rows}=await db.query(`
      SELECT id,authorization_version,model_identity,prompt_version,status,
        error_code,latency_ms,input_tokens,output_tokens,started_at,finished_at
      FROM ai_model_invocations WHERE project_id=$1
      ORDER BY started_at DESC LIMIT 60`,[projectId]);
    return {invocations:rows};
  });
}
export function listProjectAiRuns(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'members.manage',async db=>{
    const {rows}=await db.query(`
      SELECT source_message_id,kind,status,model_name,error_code,
        created_at,updated_at FROM ai_analysis_runs WHERE project_id=$1
      ORDER BY created_at DESC LIMIT 40`,[projectId]);
    return {runs:rows};
  });
}
