import {createHash} from 'node:crypto';
import {audit,transaction} from './db.ts';
import {isValidTimezone} from './policy.ts';

type CreateProjectInput={
  tenantId:string;name:string;timezone:string;idempotencyKey:string;
};
type CreatedProject={
  id:string;tenant_id:string;name:string;timezone:string;ai_enabled:boolean;
  work_start:number|null;work_end:number|null;cooldown_hours:number|null;
  settings_revision:number;owner_id:string;ownership_revision:number;
};
type Result={project:CreatedProject};
const kind='project.created.v1';
function deny(statusCode:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode});
}

/** A root project command has no projectId until the Project exists.
 * Claim a tenant-scoped receipt first; the newly generated real projectId
 * then anchors the usual PM receipt, audit, domain event and outbox atomically.
 */
export async function createProjectCommand(actorId:string,
  input:CreateProjectInput):Promise<Result>{
  if(!isValidTimezone(input.timezone))deny(400,'不支持的时区');
  const hash=createHash('sha256').update(JSON.stringify({
    tenantId:input.tenantId,name:input.name,timezone:input.timezone,
  })).digest('hex');
  return transaction(async db=>{
    const member=await db.query(`
      SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2
        AND role='admin' FOR SHARE
    `,[input.tenantId,actorId]);
    if(!member.rowCount)deny(403,'没有创建项目权限');
    const inserted=await db.query<{id:string}>(`
      INSERT INTO tenant_command_receipts(
        tenant_id,actor_id,kind,idempotency_key,payload_hash)
      VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(tenant_id,actor_id,kind,idempotency_key)
      DO NOTHING RETURNING id
    `,[input.tenantId,actorId,kind,input.idempotencyKey,hash]);
    if(!inserted.rowCount){
      const previous=await db.query<{
        payload_hash:string;project_id:string|null;result:Result;
      }>(`
        SELECT payload_hash,project_id,result
        FROM tenant_command_receipts
        WHERE tenant_id=$1 AND actor_id=$2 AND kind=$3 AND idempotency_key=$4
      `,[input.tenantId,actorId,kind,input.idempotencyKey]);
      const receipt=previous.rows[0];
      if(!receipt||receipt.payload_hash!==hash)
        deny(409,'幂等键已经用于其他命令');
      if(!receipt.project_id)
        deny(409,'原项目已删除，不能重放该创建命令');
      // Admin role alone must not reveal a Project the original creator
      // has since lost access to.
      const accessible=await db.query(`
        SELECT 1 FROM projects p
        JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
        WHERE p.tenant_id=$1 AND p.id=$3
      `,[input.tenantId,actorId,receipt.project_id]);
      if(!accessible.rowCount)deny(404,'原项目不存在或无权读取');
      return receipt.result;
    }
    const {rows}=await db.query<Omit<CreatedProject,'owner_id'>>(`
      INSERT INTO projects(tenant_id,name,timezone)
      VALUES($1,$2,$3)
      RETURNING id,tenant_id,name,timezone,ai_enabled,work_start,work_end,
        cooldown_hours,settings_revision,ownership_revision
    `,[input.tenantId,input.name,input.timezone]);
    const project:CreatedProject={...rows[0],owner_id:actorId};
    await db.query(`
      INSERT INTO project_members(project_id,user_id,role)
      VALUES($1,$2,'owner')
    `,[project.id,actorId]);
    const result:Result={project};
    const projectReceipt=await db.query<{id:string}>(`
      INSERT INTO command_receipts(tenant_id,project_id,actor_id,kind,
        idempotency_key,payload_hash,result)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id
    `,[input.tenantId,project.id,actorId,kind,input.idempotencyKey,
      hash,JSON.stringify(result)]);
    await audit(db,project.id,actorId,kind,project.id,{
      receiptId:projectReceipt.rows[0].id,version:1});
    const event=await db.query<{id:string}>(`
      INSERT INTO domain_events(tenant_id,project_id,kind,aggregate_type,
        aggregate_id,aggregate_version,command_receipt_id,payload)
      VALUES($1,$2,$3,'projects',$2,1,$4,$5) RETURNING id
    `,[input.tenantId,project.id,kind,projectReceipt.rows[0].id,
      JSON.stringify({actorId})]);
    await db.query(`
      INSERT INTO outbox_events(project_id,kind,payload)
      VALUES($1,'domain.changed',$2)
    `,[project.id,JSON.stringify({domainEventId:event.rows[0].id})]);
    await db.query(`
      UPDATE tenant_command_receipts SET project_id=$2,result=$3
      WHERE id=$1
    `,[inserted.rows[0].id,project.id,JSON.stringify(result)]);
    return result;
  });
}
