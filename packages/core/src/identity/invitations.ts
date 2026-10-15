import {createHash,randomBytes} from 'node:crypto';
import {transaction,type DbClient} from '../db.ts';
import {hashPassword} from '../security.ts';
import {organizationCommand} from '../organization-commands.ts';

export const invitationLifetimeDays=7;
export function inviteDigest(raw:string):string{
  return createHash('sha256').update(raw,'utf8').digest('hex');
}
export function newInviteCode():string{return randomBytes(32).toString('hex');}

function denied():never{
  throw Object.assign(new Error('邀请码无效、已失效或已使用'),{statusCode:403});
}
function conflict(message:string):never{
  throw Object.assign(new Error(message),{statusCode:409});
}
type InvitationRow={
  id:string;tenant_id:string;email:string;expires_at:string;
  accepted_at:string|null;revoked_at:string|null;
};
async function lockInvitation(db:DbClient,token:unknown):Promise<InvitationRow>{
  if(typeof token!=='string'||!(/^[0-9a-f]{64}$/i.test(token)))denied();
  const result=await db.query<InvitationRow>(`SELECT id,tenant_id,email,expires_at,
    accepted_at,revoked_at FROM tenant_invitations WHERE token_sha256=$1 FOR UPDATE`,
    [inviteDigest(token.toLowerCase())]);
  const item=result.rows[0];
  if(!item||item.accepted_at||item.revoked_at||
     new Date(item.expires_at).getTime()<=Date.now())denied();
  return item;
}
export async function createTenantInvitation(args:{
  tenantId:string;actorId:string;email:string;idempotencyKey:string;
}){
  const token=newInviteCode();
  let inserted=false;
  const invitation=await organizationCommand(args.tenantId,args.actorId,
    'tenant.invite_issued',{idempotencyKey:args.idempotencyKey,
      payload:{email:args.email}},async db=>{
      const member=await db.query(`SELECT 1 FROM tenant_members tm
        JOIN users u ON u.id=tm.user_id
        WHERE tm.tenant_id=$1 AND u.email=$2`,[args.tenantId,args.email]);
      if(member.rowCount)conflict('该人员已加入组织');
      await db.query(`UPDATE tenant_invitations
        SET revoked_at=NOW(),revoked_by=$3
        WHERE tenant_id=$1 AND email=$2 AND accepted_at IS NULL
          AND revoked_at IS NULL`,[args.tenantId,args.email,args.actorId]);
      const {rows}=await db.query<{
        id:string;email:string;expires_at:string;
      }>(`INSERT INTO tenant_invitations(tenant_id,email,token_sha256,invited_by,expires_at)
        VALUES($1,$2,$3,$4,NOW()+INTERVAL '7 days')
        RETURNING id,email,expires_at`,
        [args.tenantId,args.email,inviteDigest(token),args.actorId]);
      inserted=true;
      return {value:rows[0],targetId:rows[0].id,metadata:{email:args.email}};
    });
  // Replays return the receipt but cannot recreate a plaintext credential.
  // A lost response requires revocation/reissuance, not durable secret storage.
  return {invitation,code:inserted?token:null};
}
export async function revokeTenantInvitation(args:{
  tenantId:string;actorId:string;invitationId:string;idempotencyKey:string;
}){
  return organizationCommand(args.tenantId,args.actorId,'tenant.invite_revoked',
    {idempotencyKey:args.idempotencyKey,payload:{invitationId:args.invitationId}},
    async db=>{
      const {rows}=await db.query(`UPDATE tenant_invitations
        SET revoked_at=NOW(),revoked_by=$3
        WHERE tenant_id=$1 AND id=$2
          AND accepted_at IS NULL AND revoked_at IS NULL
        RETURNING id`,[args.tenantId,args.invitationId,args.actorId]);
      if(!rows.length)conflict('邀请不存在或已被使用/撤销');
      return {value:{ok:true},targetId:args.invitationId};
    });
}
export async function acceptTenantInvitationNew(args:{
  token:string;email:string;displayName:string;password:string;
}):Promise<string>{
  return transaction(async db=>{
    const invite=await lockInvitation(db,args.token);
    if(invite.email!==args.email)denied();
    const found=await db.query('SELECT 1 FROM users WHERE email=$1',[args.email]);
    if(found.rowCount)conflict('账号已存在，请先登录再接受邀请');
    const created=await db.query<{id:string}>(`INSERT INTO users
      (email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id`,
      [args.email,args.displayName,hashPassword(args.password)]);
    const userId=created.rows[0].id;
    await consumeInvitation(db,invite,userId);
    return userId;
  });
}
export async function acceptTenantInvitationExisting(args:{
  token:string;userId:string;
}):Promise<{tenantId:string}>{
  return transaction(async db=>{
    const invite=await lockInvitation(db,args.token);
    const user=(await db.query<{email:string}>(`SELECT email FROM users
      WHERE id=$1 FOR SHARE`,[args.userId])).rows[0];
    if(!user||user.email!==invite.email)denied();
    await consumeInvitation(db,invite,args.userId);
    return {tenantId:invite.tenant_id};
  });
}
async function consumeInvitation(db:DbClient,invite:InvitationRow,userId:string){
  const {rows}=await db.query(`INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'member') ON CONFLICT DO NOTHING RETURNING user_id`,
    [invite.tenant_id,userId]);
  if(!rows.length)conflict('该用户已经加入指定组织');
  await db.query(`UPDATE tenant_invitations
    SET accepted_at=NOW(),accepted_by=$2 WHERE id=$1`,[invite.id,userId]);
  await db.query(`INSERT INTO organization_audit_entries
    (tenant_id,actor_id,action,target_id,metadata)
    VALUES($1,$2,'tenant.invite_accepted',$3,$4)`,
    [invite.tenant_id,userId,invite.id,JSON.stringify({email:invite.email})]);
}
