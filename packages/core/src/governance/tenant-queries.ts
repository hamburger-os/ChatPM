import {transaction,type DbClient} from '../db.ts';

function unauthorized():never{
  throw Object.assign(new Error('没有该组织的管理权限'),{statusCode:403});
}

/** One current-membership snapshot for sensitive tenant-admin reads.
 * No HTTP preflight read can be reused after revocation.
 */
function withTenantAdminRead<T>(
  tenantId:string,actorId:string,query:(db:DbClient)=>Promise<T>,
):Promise<T>{
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const member=await db.query<{role:string}>(`
      SELECT role FROM tenant_members
      WHERE tenant_id=$1 AND user_id=$2 FOR SHARE
    `,[tenantId,actorId]);
    if(member.rows[0]?.role!=='admin')unauthorized();
    return query(db);
  });
}

export function listTenantMembers(tenantId:string,actorId:string){
  return withTenantAdminRead(tenantId,actorId,async db=>{
    const {rows}=await db.query(`
      SELECT u.id,u.display_name,u.email,tm.role
      FROM tenant_members tm JOIN users u ON u.id=tm.user_id
      WHERE tm.tenant_id=$1 ORDER BY u.display_name
    `,[tenantId]);
    return {members:rows};
  });
}

export function listTenantAllocations(tenantId:string,actorId:string){
  return withTenantAdminRead(tenantId,actorId,async db=>{
    const {rows}=await db.query(`
      SELECT a.id,a.project_id,a.user_id,a.percentage,
        a.start_date::text AS start_date,a.end_date::text AS end_date,
        a.cancelled_at,a.cancelled_by
      FROM resource_allocations a
      WHERE a.tenant_id=$1 ORDER BY a.start_date DESC LIMIT 500
    `,[tenantId]);
    return {allocations:rows};
  });
}
