import {withTenantAdminRead} from '../identity/tenant-admin-read.ts';

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
