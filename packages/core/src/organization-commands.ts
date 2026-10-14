import { transaction, type DbClient } from './db.ts';

export type OrganizationMutation<T> = {
  value:T;
  targetId:string|null;
  metadata?:Record<string,unknown>;
};

/**
 * Organization writes are serialized per tenant. The acting administrator is
 * revalidated after acquiring the lock so role revocation cannot race a write.
 * The mutation and its audit record commit or roll back together.
 */
export async function organizationCommand<T>(
  tenantId:string, actorId:string, action:string,
  mutate:(db:DbClient)=>Promise<OrganizationMutation<T>>,
):Promise<T>{
  return transaction(async db=>{
    // This same lock guards administrator role updates and other governance writes.
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['tenant-governance:'+tenantId]);
    const {rows}=await db.query<{role:string}>(
      'SELECT role FROM tenant_members WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE',
      [tenantId,actorId]);
    if(rows[0]?.role!=='admin')
      throw Object.assign(new Error('没有该组织的管理权限'),{statusCode:403});
    const change=await mutate(db);
    await db.query(`INSERT INTO organization_audit_entries
      (tenant_id,actor_id,action,target_id,metadata)
      VALUES($1,$2,$3,$4,$5)`,
      [tenantId,actorId,action,change.targetId,JSON.stringify(change.metadata??{})]);
    return change.value;
  });
}
