import type { DbClient } from '../db.ts';

/** Only assign work to a current project AND organization member. */
export async function ensureTaskAssignee(
  db:DbClient,projectId:string,userId:string,
):Promise<void>{
  const r=await db.query(`SELECT 1 FROM project_members pm
    JOIN projects p ON p.id=pm.project_id
    JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
    WHERE pm.project_id=$1 AND pm.user_id=$2 AND pm.role<>'observer'
    FOR SHARE OF pm,tm`,[projectId,userId]);
  if(!r.rowCount)throw Object.assign(
    new Error('负责人不属于本项目'),{statusCode:400});
}
