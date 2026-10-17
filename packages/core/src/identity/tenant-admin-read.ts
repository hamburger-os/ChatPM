import {transaction,type DbClient} from '../db.ts';

/** A single authoritative admin read boundary for tenant-sensitive data.
 * Revocation and the authorized query share one locked PostgreSQL snapshot.
 * Do not precheck in HTTP and then query another connection.
 */
export function withTenantAdminRead<T>(
  tenantId:string,actorId:string,query:(db:DbClient)=>Promise<T>,
):Promise<T>{
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const member=await db.query<{role:string}>(`
      SELECT role FROM tenant_members
      WHERE tenant_id=$1 AND user_id=$2 FOR SHARE
    `,[tenantId,actorId]);
    if(member.rows[0]?.role!=='admin')
      throw Object.assign(new Error('没有该组织的管理权限'),{statusCode:403});
    return query(db);
  });
}
