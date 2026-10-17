import {withProjectRead} from '../identity/project-access.ts';

/** Pending AI findings are project-scoped evidence, not formal work state. */
export function listProjectProgress(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'read',async db=>{
    const {rows}=await db.query(`
      SELECT u.id,u.task_id,u.source_message_id,u.summary,u.kind,u.status,
        u.created_at,t.title AS task_title
      FROM task_progress_updates u
      JOIN tasks t ON t.id=u.task_id AND t.project_id=u.project_id
      WHERE u.project_id=$1 ORDER BY u.created_at DESC LIMIT 150`,[projectId]);
    return {updates:rows};
  });
}
export function listProjectProposals(projectId:string,actorId:string){
  return withProjectRead(projectId,actorId,'read',async db=>{
    const {rows}=await db.query(`
      SELECT pc.*,ct.assignee_hint AS clarified_assignee_hint,
        ct.due_at AS clarified_due_at,ct.status AS clarification_status,
        ct.response_message_id AS clarification_message_id
      FROM proposed_changes pc
      LEFT JOIN clarification_threads ct ON ct.proposal_id=pc.id
      WHERE pc.project_id=$1 ORDER BY pc.created_at DESC LIMIT 200`,[projectId]);
    return {proposals:rows};
  });
}
