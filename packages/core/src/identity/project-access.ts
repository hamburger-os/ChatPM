import {transaction, type DbClient} from '../db.ts';
import {assertProject, type ProjectAction} from '../permissions.ts';
import type { ProjectRole } from '../permissions.ts';

/**
 * Recheck the CURRENT tenant + project membership inside the command transaction.
 * FOR SHARE prevents concurrent role changes/removal from bypassing authorization.
 */
export async function lockProjectAccess(db:DbClient,projectId:string,actorId:string):
  Promise<{tenantId:string;role:ProjectRole}>{
  const {rows}=await db.query<{tenant_id:string;role:ProjectRole}>(`
    SELECT p.tenant_id,pm.role FROM projects p
    JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
    JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=$2
    WHERE p.id=$1 FOR SHARE OF pm,tm
  `,[projectId,actorId]);
  if(!rows[0])throw Object.assign(
    new Error('项目不存在或无权限'),{statusCode:404});
  return {tenantId:rows[0].tenant_id,role:rows[0].role};
}

/** Current project + tenant membership and the read share one snapshot. */
export async function withProjectRead<T>(
  projectId:string,actorId:string,action:ProjectAction,
  query:(db:DbClient)=>Promise<T>,
):Promise<T>{
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const access=await lockProjectAccess(db,projectId,actorId);
    assertProject(access.role,action);
    return query(db);
  });
}
