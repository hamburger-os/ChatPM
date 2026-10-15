import {createHash} from 'node:crypto';
import {transaction,type DbClient} from './db.ts';

export type OrganizationMutation<T> = {
  value:T;
  targetId:string|null;
  metadata?:Record<string,unknown>;
};
export type TenantCommandRequest={
  idempotencyKey:string;
  payload:unknown;
};
function deny(code:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode:code});
}

/**
 * Every organization write shares an actor+tenant command receipt.
 * The same advisory lock also protects tenant-admin demotion, so authorization
 * remains current inside the same transaction as the business change.
 */
export async function organizationCommand<T>(
  tenantId:string,actorId:string,action:string,
  command:TenantCommandRequest,
  mutate:(db:DbClient)=>Promise<OrganizationMutation<T>>,
):Promise<T>{
  return transaction(async db=>{
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      ['tenant-governance:'+tenantId]);
    const {rows}=await db.query<{role:string}>(
      'SELECT role FROM tenant_members WHERE tenant_id=$1 AND user_id=$2 FOR UPDATE',
      [tenantId,actorId]);
    if(rows[0]?.role!=='admin')deny(403,'没有该组织的管理权限');

    const hash=createHash('sha256').update(JSON.stringify(command.payload)).digest('hex');
    const inserted=await db.query<{id:string}>(`
      INSERT INTO tenant_command_receipts(tenant_id,actor_id,kind,idempotency_key,payload_hash)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(tenant_id,actor_id,kind,idempotency_key) DO NOTHING RETURNING id
    `,[tenantId,actorId,action,command.idempotencyKey,hash]);
    if(!inserted.rowCount){
      const old=await db.query<{payload_hash:string;result:T}>(`
        SELECT payload_hash,result FROM tenant_command_receipts
        WHERE tenant_id=$1 AND actor_id=$2 AND kind=$3 AND idempotency_key=$4
      `,[tenantId,actorId,action,command.idempotencyKey]);
      if(!old.rows[0]||old.rows[0].payload_hash!==hash)
        deny(409,'幂等键已经用于其他组织命令');
      return old.rows[0].result;
    }

    const change=await mutate(db);
    await db.query(`
      INSERT INTO organization_audit_entries(tenant_id,actor_id,action,target_id,metadata)
      VALUES($1,$2,$3,$4,$5)
    `,[tenantId,actorId,action,change.targetId,JSON.stringify(change.metadata??{})]);
    await db.query('UPDATE tenant_command_receipts SET result=$2 WHERE id=$1',
      [inserted.rows[0].id,JSON.stringify(change.value)]);
    return change.value;
  });
}
