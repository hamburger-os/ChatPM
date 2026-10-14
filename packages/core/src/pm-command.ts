import { createHash } from 'node:crypto';
import { audit, transaction, type DbClient } from './db.ts';
import { assertProject, type ProjectAction, type ProjectRole } from './permissions.ts';
import { lockProjectAccess } from './identity/project-access.ts';

function deny(statusCode:number,message:string):never {
  throw Object.assign(new Error(message),{statusCode});
}

export type PmMutation<T> = {
  response:T;
  aggregateType:string;
  aggregateId:string;
  aggregateVersion:number;
};

export type PmCommand<T> = {
  projectId:string;
  actorId:string;
  idempotencyKey:string;
  kind:string;
  action:ProjectAction;
  payload:unknown;
  mutate:(db:DbClient,role:ProjectRole)=>Promise<PmMutation<T>>;
};

/** All official PM state changes and their receipts/events/audit share one transaction. */
export async function executePmCommand<T>(command:PmCommand<T>):Promise<T> {
  return transaction(async db=>{
    const member=await lockProjectAccess(db,command.projectId,command.actorId);
    assertProject(member.role,command.action);
    const hash=createHash('sha256').update(JSON.stringify(command.payload)).digest('hex');
    const inserted=await db.query<{id:string}>(`
      INSERT INTO command_receipts(tenant_id,project_id,actor_id,kind,
        idempotency_key,payload_hash)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(project_id,actor_id,kind,idempotency_key) DO NOTHING
      RETURNING id
    `,[member.tenantId,command.projectId,command.actorId,
      command.kind,command.idempotencyKey,hash]);
    if(!inserted.rowCount){
      const old=await db.query<{payload_hash:string;result:T}>(`
        SELECT payload_hash,result FROM command_receipts
        WHERE project_id=$1 AND actor_id=$2 AND kind=$3 AND idempotency_key=$4
      `,[command.projectId,command.actorId,command.kind,command.idempotencyKey]);
      if(!old.rows[0]||old.rows[0].payload_hash!==hash)deny(409,'幂等键已经用于其他命令');
      return old.rows[0].result;
    }
    const created=await command.mutate(db,member.role);
    await audit(db,command.projectId,command.actorId,command.kind,
      created.aggregateId,{version:created.aggregateVersion,
        receiptId:inserted.rows[0].id});
    const event=await db.query<{id:string}>(`
      INSERT INTO domain_events(tenant_id,project_id,kind,aggregate_type,
        aggregate_id,aggregate_version,command_receipt_id,payload)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING id
    `,[member.tenantId,command.projectId,command.kind,
      created.aggregateType,created.aggregateId,created.aggregateVersion,
      inserted.rows[0].id,JSON.stringify({actorId:command.actorId})]);
    await db.query(`
      INSERT INTO outbox_events(project_id,kind,payload)
      VALUES($1,'domain.changed',$2)
    `,[command.projectId,JSON.stringify({domainEventId:event.rows[0].id})]);
    await db.query('UPDATE command_receipts SET result=$2 WHERE id=$1',
      [inserted.rows[0].id,JSON.stringify(created.response)]);
    return created.response;
  });
}
