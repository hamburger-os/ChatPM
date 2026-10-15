import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {createTenantInvitation,revokeTenantInvitation,
  acceptTenantInvitationExisting,acceptTenantInvitationNew} from '../src/identity/invitations.ts';

const suffix=randomUUID();
try{
  const a=(await pool.query("INSERT INTO users(email,display_name,password_hash) VALUES($1,'Invite Admin','unused') RETURNING id",
    ['invite-admin-'+suffix+'@example.test'])).rows[0];
  const tenant=(await pool.query("INSERT INTO tenants(name) VALUES('Invite integration') RETURNING id")).rows[0];
  await pool.query("INSERT INTO tenant_members(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [tenant.id,a.id]);
  const targetEmail='invite-member-'+suffix+'@example.test';
  const key=randomUUID();
  const issued=await createTenantInvitation({tenantId:tenant.id,actorId:a.id,
    email:targetEmail,idempotencyKey:key});
  assert.match(issued.code??'',/^[0-9a-f]{64}$/);
  const replay=await createTenantInvitation({tenantId:tenant.id,actorId:a.id,
    email:targetEmail,idempotencyKey:key});
  assert.equal(replay.code,null,'Receipt must never contain a recoverable secret');
  assert.equal(replay.invitation.id,issued.invitation.id);
  const stored=(await pool.query(
    'SELECT token_sha256 FROM tenant_invitations WHERE id=$1',[issued.invitation.id])).rows[0];
  assert.notEqual(stored.token_sha256,issued.code,'Plaintext invite must never reach DB');
  await assert.rejects(acceptTenantInvitationNew({
    token:'0'.repeat(64),email:targetEmail,displayName:'Invited',
    password:'Strong-password-12345',
  }),/邀请码无效/);
  await assert.rejects(acceptTenantInvitationNew({
    token:issued.code!,email:'other-'+suffix+'@example.test',displayName:'Wrong',
    passwordHash:'unused',
  }),/邀请码无效/,'Token must be bound to the intended email');
  const newMember=await acceptTenantInvitationNew({
    token:issued.code!,email:targetEmail,displayName:'Invited',
    passwordHash:'unused',
  });
  assert.equal((await pool.query(
    "SELECT role FROM tenant_members WHERE tenant_id=$1 AND user_id=$2",
    [tenant.id,newMember])).rows[0].role,'member');
  await assert.rejects(acceptTenantInvitationNew({
    token:issued.code!,email:targetEmail,displayName:'Replay',
    passwordHash:'unused',
  }),/邀请码无效/,'Consumed token must never create another identity');

  const existing=(await pool.query(
    "INSERT INTO users(email,display_name,password_hash) VALUES($1,'Existing user','unused') RETURNING id",
    ['existing-'+suffix+'@example.test'])).rows[0];
  const second=await createTenantInvitation({tenantId:tenant.id,actorId:a.id,
    email:'existing-'+suffix+'@example.test',idempotencyKey:randomUUID()});
  await assert.rejects(acceptTenantInvitationExisting({
    token:second.code!,userId:newMember}),/邀请码无效/,
    'An invitation must not enroll a logged-in user with a different email');
  const claim=await acceptTenantInvitationExisting({token:second.code!,userId:existing.id});
  assert.equal(claim.tenantId,tenant.id);
  await assert.rejects(acceptTenantInvitationExisting({
    token:second.code!,userId:existing.id}),/邀请码无效/);

  const revoke=await createTenantInvitation({tenantId:tenant.id,actorId:a.id,
    email:'revoked-'+suffix+'@example.test',idempotencyKey:randomUUID()});
  const revokeKey=randomUUID();
  await revokeTenantInvitation({tenantId:tenant.id,actorId:a.id,
    invitationId:revoke.invitation.id,idempotencyKey:revokeKey});
  await revokeTenantInvitation({tenantId:tenant.id,actorId:a.id,
    invitationId:revoke.invitation.id,idempotencyKey:revokeKey});
  await assert.rejects(acceptTenantInvitationNew({
    token:revoke.code!,email:'revoked-'+suffix+'@example.test',
    displayName:'Revoked',passwordHash:'unused',
  }),/邀请码无效/);

  const concurrent=await createTenantInvitation({tenantId:tenant.id,actorId:a.id,
    email:'race-'+suffix+'@example.test',idempotencyKey:randomUUID()});
  const attempts=await Promise.allSettled(Array.from({length:3},()=>
    acceptTenantInvitationNew({
      token:concurrent.code!,email:'race-'+suffix+'@example.test',
      displayName:'Race',passwordHash:'unused',
    })));
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1,
    'Concurrent claims must not duplicate user or tenant member');
  console.log('Invitation integration passed: secret hashing, replay, email scope, revocation and concurrent one-time acceptance');
}finally{
  await pool.end();
}
