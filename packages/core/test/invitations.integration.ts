import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {pool} from '../src/db.ts';
import {createTenantInvitation,revokeTenantInvitation,listTenantInvitations,
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
  const firstList=await listTenantInvitations(tenant.id,a.id);
  assert.equal(firstList.invitations.length,1);
  assert.equal(firstList.invitations[0].id,issued.invitation.id);
  assert.equal(firstList.invitations[0].email,targetEmail);
  assert.equal('token_sha256' in firstList.invitations[0],false,
    'Only invitation metadata, never secret digests, may be listed');
  assert.equal(JSON.stringify(firstList).includes(issued.code??'impossible'),false);

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
    password:'Strong-password-12345',
  }),/邀请码无效/,'Token must be bound to the intended email');
  const newMember=await acceptTenantInvitationNew({
    token:issued.code!,email:targetEmail,displayName:'Invited',
    password:'Strong-password-12345',
  });
  assert.equal((await pool.query(
    "SELECT role FROM tenant_members WHERE tenant_id=$1 AND user_id=$2",
    [tenant.id,newMember])).rows[0].role,'member');
  await assert.rejects(listTenantInvitations(tenant.id,newMember),
    /没有该组织的管理权限/,
    'Invited ordinary members must not read private invitation email addresses');
  const foreign=(await pool.query<{id:string}>(`
    INSERT INTO tenants(name) VALUES('Unrelated invitation tenant')
    RETURNING id`)).rows[0].id;
  await assert.rejects(listTenantInvitations(foreign,a.id),
    /没有该组织的管理权限/,'Cross-tenant invitation reads are denied');

  await assert.rejects(acceptTenantInvitationNew({
    token:issued.code!,email:targetEmail,displayName:'Replay',
    password:'Strong-password-12345',
  }),/邀请码无效/,'Consumed token must never create another identity');

  await assert.rejects(createTenantInvitation({
    tenantId:tenant.id,actorId:newMember,email:'unauthorized-'+suffix+'@example.test',
    idempotencyKey:randomUUID(),
  }),/没有该组织的管理权限/,'Regular members cannot issue invitations');

  const expired=await createTenantInvitation({tenantId:tenant.id,actorId:a.id,
    email:'expired-'+suffix+'@example.test',idempotencyKey:randomUUID()});
  await pool.query(`UPDATE tenant_invitations SET
    created_at=NOW()-INTERVAL '9 days',expires_at=NOW()-INTERVAL '1 day'
    WHERE id=$1`,[expired.invitation.id]);
  await assert.rejects(acceptTenantInvitationNew({
    token:expired.code!,email:'expired-'+suffix+'@example.test',
    displayName:'Expired',password:'Strong-password-12345',
  }),/邀请码无效/,'Expired invitations cannot be claimed');

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
    displayName:'Revoked',password:'Strong-password-12345',
  }),/邀请码无效/);

  const concurrent=await createTenantInvitation({tenantId:tenant.id,actorId:a.id,
    email:'race-'+suffix+'@example.test',idempotencyKey:randomUUID()});
  const attempts=await Promise.allSettled(Array.from({length:3},()=>
    acceptTenantInvitationNew({
      token:concurrent.code!,email:'race-'+suffix+'@example.test',
      displayName:'Race',password:'Strong-password-12345',
    })));
  assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1,
    'Concurrent claims must not duplicate user or tenant member');
  // Hold an admin demotion transaction open while a sensitive read starts.
  // The query cannot reuse an HTTP precheck and expose emails after revocation.
  const demote=await pool.connect();
  try{
    await demote.query('BEGIN');
    await demote.query(`
      UPDATE tenant_members SET role='member'
      WHERE tenant_id=$1 AND user_id=$2`,[tenant.id,a.id]);
    let finished=false;
    // Attach BOTH promise branches immediately to avoid a transient
    // unhandled rejection when PostgreSQL detects serialization failure.
    const pending=listTenantInvitations(tenant.id,a.id).then(
      ()=>{finished=true;return {ok:true,error:null};},
      (error:unknown)=>{finished=true;return {ok:false,error};},
    );
    await delay(80);
    assert.equal(finished,false,'Revocation row lock must block the sensitive read');
    await demote.query('COMMIT');
    const outcome=await pending;
    assert.equal(outcome.ok,false,'Revoked administrator must never receive invite emails');
    const e=outcome.error as {code?:string;statusCode?:number};
    // REPEATABLE READ can fail with 40001 when the locked grant changed
    // since the read snapshot; both outcomes fail closed with no emails.
    assert.ok(e.code==='40001'||e.statusCode===403);
  }finally{
    try{await demote.query('ROLLBACK');}catch{}
    demote.release();
  }
  await assert.rejects(listTenantInvitations(tenant.id,a.id),
    /没有该组织的管理权限/,
    'Committed demotion must remove sensitive invitation access');
  await assert.rejects(createTenantInvitation({
    tenantId:tenant.id,actorId:a.id,
    email:'rejected-after-revocation-'+suffix+'@example.test',
    idempotencyKey:randomUUID(),
  }),/没有该组织的管理权限/,
  'Write commands must independently authorize the current admin grant');
  await assert.rejects(revokeTenantInvitation({
    tenantId:tenant.id,actorId:a.id,invitationId:issued.invitation.id,
    idempotencyKey:randomUUID(),
  }),/没有该组织的管理权限/);

  console.log('Invitation integration passed: secret hashing, replay, email scope, revocation and concurrent one-time acceptance');
}finally{
  await pool.end();
}
