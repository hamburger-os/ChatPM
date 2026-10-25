import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {transaction,audit,type DbClient} from '../db.ts';
import {serverConfig} from '../config.ts';
import {organizationCommand} from '../organization-commands.ts';
import {lockProjectAccess} from '../identity/project-access.ts';
import {assertProject} from '../permissions.ts';
import {insertMessage} from '../messages.ts';
import type {InboundText} from '../../../im/src/contracts.ts';

const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
const uuid=z.string().uuid();
const externalId=z.string().min(1).max(200).regex(/^[^\r\n]+$/);
const secretSchema=z.string().min(16).max(4096).regex(/^[^\r\n]+$/);
const fail=(statusCode:number,message:string):never=>{
  throw Object.assign(new Error(message),{statusCode});
};
function secretKey():Buffer{
  const secret=serverConfig.IM_ENCRYPTION_KEY;
  if(!secret||secret.length<32)throw new Error('IM_ENCRYPTION_KEY_NOT_CONFIGURED');
  return createHash('sha256').update('chatpm:im:v1:').update(secret).digest();
}
function encrypt(value:string):string{
  const nonce=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',secretKey(),nonce);
  const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return Buffer.concat([nonce,cipher.getAuthTag(),ciphertext]).toString('base64');
}
function decrypt(value:string):string{
  try{
    const raw=Buffer.from(value,'base64');
    if(raw.length<29)throw Error('invalid');
    const decipher=createDecipheriv('aes-256-gcm',secretKey(),raw.subarray(0,12));
    decipher.setAuthTag(raw.subarray(12,28));
    return Buffer.concat([decipher.update(raw.subarray(28)),decipher.final()]).toString('utf8');
  }catch{throw Error('IM_CREDENTIAL_DECRYPTION_FAILED');}
}

/** Tenant-admin-only registered bot; neither HTTP nor logs expose the ciphertext. */
export function registerWecomBot(tenantId:string,actorId:string,raw:unknown){
  const v=z.object({botId:externalId,secret:secretSchema,idempotencyKey:uuid}).strict().parse(raw);
  return organizationCommand(tenantId,actorId,'im.bot_registered',{
    idempotencyKey:v.idempotencyKey,payload:{botId:v.botId,secretHash:hash(v.secret)},
  },async db=>{
    const r=await db.query<{id:string,external_bot_id:string}>(`
      INSERT INTO im_accounts(tenant_id,channel,external_bot_id,secret_ciphertext)
      VALUES($1,'wecom',$2,$3) RETURNING id,external_bot_id`,
      [tenantId,v.botId,encrypt(v.secret)]);
    return {value:{id:r.rows[0].id,botId:r.rows[0].external_bot_id},
      targetId:r.rows[0].id,metadata:{channel:'wecom'}};
  });
}
export function listWecomBots(tenantId:string,actorId:string){
  return transaction(async db=>{
    const member=await db.query<{role:string}>(`
      SELECT role FROM tenant_members WHERE tenant_id=$1 AND user_id=$2 FOR SHARE`,
      [tenantId,actorId]);
    if(member.rows[0]?.role!=='admin')fail(403,'没有该组织的管理权限');
    const r=await db.query<{id:string,external_bot_id:string,enabled:boolean}>(`
      SELECT id,external_bot_id,enabled FROM im_accounts
      WHERE tenant_id=$1 ORDER BY created_at`,[tenantId]);
    return {bots:r.rows.map(x=>({id:x.id,botId:x.external_bot_id,enabled:x.enabled}))};
  });
}
export function listEnabledWecomBots(){
  return transaction(async db=>{
    const r=await db.query<{id:string,external_bot_id:string,secret_ciphertext:string}>(`
      SELECT id,external_bot_id,secret_ciphertext FROM im_accounts
      WHERE channel='wecom' AND enabled ORDER BY id`);
    return r.rows.map(x=>({id:x.id,botId:x.external_bot_id,secret:decrypt(x.secret_ciphertext)}));
  });
}
export function disableWecomBot(tenantId:string,actorId:string,accountId:string,idempotencyKey:string){
  uuid.parse(idempotencyKey);
  return organizationCommand(tenantId,actorId,'im.bot_disabled',{
    idempotencyKey,
    payload:{accountId},
  },async db=>{
    const updated=await db.query<{id:string}>(`
      UPDATE im_accounts SET enabled=false WHERE id=$1 AND tenant_id=$2 AND enabled
      RETURNING id`,[accountId,tenantId]);
    if(!updated.rowCount)fail(404,'机器人不存在或已停用');
    return {value:{ok:true},targetId:accountId};
  });
}

async function createChallenge(db:DbClient,accountId:string,actorId:string,
  tenantId:string,purpose:'user'|'room',projectId:string|null){
  const token=randomBytes(24).toString('hex');
  await db.query(`
    INSERT INTO im_binding_challenges
      (tenant_id,account_id,actor_id,project_id,purpose,code_hash,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,now()+interval '10 minutes')`,
    [tenantId,accountId,actorId,projectId,purpose,hash(token)]);
  return {command:(purpose==='user'?'/bind ':'/link ')+token,expiresInSeconds:600};
}
export function beginWecomUserBinding(accountId:string,actorId:string){
  return transaction(async db=>{
    const r=await db.query<{tenant_id:string}>(`
      SELECT a.tenant_id FROM im_accounts a
      JOIN tenant_members tm ON tm.tenant_id=a.tenant_id AND tm.user_id=$2
      WHERE a.id=$1 AND a.enabled FOR SHARE OF a,tm`,[accountId,actorId]);
    if(!r.rows[0])fail(404,'机器人未启用或用户无权访问');
    return createChallenge(db,accountId,actorId,r.rows[0].tenant_id,'user',null);
  });
}
export function beginWecomRoomBinding(projectId:string,accountId:string,actorId:string){
  return transaction(async db=>{
    const access=await lockProjectAccess(db,projectId,actorId);
    assertProject(access.role,'members.manage');
    const r=await db.query(`
      SELECT 1 FROM im_accounts WHERE id=$1 AND tenant_id=$2 AND enabled FOR SHARE`,
      [accountId,access.tenantId]);
    if(!r.rowCount)fail(404,'机器人不存在或不属于项目组织');
    return createChallenge(db,accountId,actorId,access.tenantId,'room',projectId);
  });
}
export function revokeWecomRoomBinding(projectId:string,accountId:string,actorId:string){
  return transaction(async db=>{
    const access=await lockProjectAccess(db,projectId,actorId);
    assertProject(access.role,'members.manage');
    const r=await db.query<{id:string}>(`
      UPDATE im_room_bindings SET active=false,revoked_at=now()
      WHERE project_id=$1 AND account_id=$2 AND tenant_id=$3 AND active RETURNING id`,
      [projectId,accountId,access.tenantId]);
    if(!r.rows[0])fail(404,'未绑定机器人群聊');
    await audit(db,projectId,actorId,'im.room_revoked',r.rows[0].id);
    return {ok:true};
  });
}
function commandToken(text:string,kind:'bind'|'link'):string|null{
  const pattern=kind==='link'
    ? /(?:^|\s)\/link ([a-f0-9]{48})$/
    : /^\/bind ([a-f0-9]{48})$/;
  return pattern.exec(text)?.[1]??null;
}
type Acceptance={status:'ignored'|'user-bound'|'room-bound'|'stored'|'duplicate'};
/**
 * Invoked only by the authenticated channel connection, never by an HTTP endpoint.
 * All authorizations and message+Outbox writes belong to this ONE transaction.
 */
export function acceptWecomMessage(accountId:string,event:InboundText):Promise<Acceptance>{
  return transaction(async db=>{
    if(event.channel!=='wecom')return {status:'ignored'};
    const account=await db.query<{tenant_id:string,external_bot_id:string}>(`
      SELECT tenant_id,external_bot_id FROM im_accounts
      WHERE id=$1 AND channel='wecom' AND enabled FOR SHARE`,[accountId]);
    const a=account.rows[0];
    if(!a||a.external_bot_id!==event.accountId)return {status:'ignored'};
    if(!externalId.safeParse(event.externalActorId).success
      ||!externalId.safeParse(event.externalMessageId).success
      ||!externalId.safeParse(event.route?.externalConversationId).success
      ||typeof event.text!=='string'||event.text.length>10000)return {status:'ignored'};
    const tenantId=a.tenant_id;
    if(event.route.kind==='direct'){
      const token=commandToken(event.text,'bind');
      if(!token||event.route.externalConversationId!==event.externalActorId)
        return {status:'ignored'};
      const q=await db.query<{id:string,actor_id:string}>(`
        SELECT id,actor_id FROM im_binding_challenges
        WHERE tenant_id=$1 AND account_id=$2 AND purpose='user'
          AND code_hash=$3 AND consumed_at IS NULL AND expires_at>now()
        FOR UPDATE`,[tenantId,accountId,hash(token)]);
      if(!q.rows[0])return {status:'ignored'};
      const m=await db.query(`
        SELECT 1 FROM tenant_members WHERE tenant_id=$1 AND user_id=$2 FOR SHARE`,
        [tenantId,q.rows[0].actor_id]);
      if(!m.rowCount)return {status:'ignored'};
      await db.query(`
        INSERT INTO im_user_bindings(tenant_id,account_id,user_id,external_user_id)
        VALUES($1,$2,$3,$4)`,
        [tenantId,accountId,q.rows[0].actor_id,event.externalActorId]);
      await db.query('UPDATE im_binding_challenges SET consumed_at=now() WHERE id=$1',
        [q.rows[0].id]);
      return {status:'user-bound'};
    }
    if(event.route.kind!=='group')return {status:'ignored'};
    const link=commandToken(event.text,'link');
    if(link){
      const q=await db.query<{id:string,actor_id:string,project_id:string}>(`
        SELECT id,actor_id,project_id FROM im_binding_challenges
        WHERE tenant_id=$1 AND account_id=$2 AND purpose='room'
        AND code_hash=$3 AND consumed_at IS NULL AND expires_at>now()
        FOR UPDATE`,[tenantId,accountId,hash(link)]);
      if(!q.rows[0])return {status:'ignored'};
      const linked=await db.query(`
        SELECT 1 FROM im_user_bindings
        WHERE tenant_id=$1 AND account_id=$2 AND user_id=$3
          AND external_user_id=$4 AND active FOR SHARE`,
        [tenantId,accountId,q.rows[0].actor_id,event.externalActorId]);
      if(!linked.rowCount)return {status:'ignored'};
      const access=await lockProjectAccess(db,q.rows[0].project_id,q.rows[0].actor_id);
      assertProject(access.role,'members.manage');
      await db.query(`
        INSERT INTO im_room_bindings(tenant_id,account_id,project_id,external_chat_id)
        VALUES($1,$2,$3,$4)`,[tenantId,accountId,
        q.rows[0].project_id,event.route.externalConversationId]);
      await audit(db,q.rows[0].project_id,q.rows[0].actor_id,
        'im.room_bound',accountId);
      await db.query('UPDATE im_binding_challenges SET consumed_at=now() WHERE id=$1',
        [q.rows[0].id]);
      return {status:'room-bound'};
    }
    const binding=await db.query<{project_id:string,user_id:string}>(`
      SELECT room.project_id,person.user_id FROM im_room_bindings room
      JOIN im_user_bindings person ON person.tenant_id=room.tenant_id
        AND person.account_id=room.account_id
        AND person.external_user_id=$3 AND person.active
      WHERE room.tenant_id=$1 AND room.account_id=$2
        AND room.external_chat_id=$4 AND room.active
      FOR SHARE OF room,person`,
      [tenantId,accountId,event.externalActorId,event.route.externalConversationId]);
    if(!binding.rows[0])return {status:'ignored'};
    const {project_id:projectId,user_id:userId}=binding.rows[0];
    const access=await lockProjectAccess(db,projectId,userId);
    assertProject(access.role,'message.write');
    const nonce='im:'+hash(JSON.stringify([accountId,event.externalMessageId]));
    const old=await db.query(`
      SELECT id FROM im_inbox WHERE account_id=$1 AND external_message_id=$2`,
      [accountId,event.externalMessageId]);
    if(old.rowCount)return {status:'duplicate'};
    const message=await insertMessage(db,{
      projectId,authorId:userId,kind:'user',content:event.text,nonce,
    });
    if(!message)return {status:'duplicate'};
    await db.query(`
      INSERT INTO im_inbox
      (tenant_id,account_id,external_message_id,external_user_id,project_id,user_id,message_id)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId,accountId,event.externalMessageId,event.externalActorId,
        projectId,userId,message.id]);
    await db.query(`
      INSERT INTO outbox_events(project_id,kind,message_id)
      VALUES($1,'message.created',$2)`,[projectId,message.id]);
    await audit(db,projectId,userId,'message.created',message.id,{source:'wecom'});
    return {status:'stored'};
  });
}

/** Metadata-only Bot discovery for current members; never expose credentials. */
export function listVisibleWecomBots(actorId:string){
  return transaction(async db=>{
    const r=await db.query<{id:string,tenant_id:string,external_bot_id:string}>(`
      SELECT a.id,a.tenant_id,a.external_bot_id FROM im_accounts a
      JOIN tenant_members tm ON tm.tenant_id=a.tenant_id
      WHERE tm.user_id=$1 AND a.enabled ORDER BY a.created_at`,[actorId]);
    return {bots:r.rows.map(x=>({id:x.id,tenantId:x.tenant_id,botId:x.external_bot_id}))};
  });
}
