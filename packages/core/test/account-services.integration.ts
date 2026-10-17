import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {
  getRegistrationStatus,registerAccount,authenticateAccount,
  getAccountProfile,listAccountTenants,
} from '../src/identity/account-services.ts';

const marker=randomUUID();
try{
  const policy=await getRegistrationStatus();
  assert.equal(policy.allowed,true,
    'CI explicitly runs development/open account registration');
  assert.equal(policy.requiresBootstrapToken,false);

  const email='account-core-'+marker+'@example.test';
  const input={email,displayName:'Identity Integration',
    password:'long-integration-password-123'};
  const created=await registerAccount(input);
  assert.equal(created.email,email);
  assert.equal(created.display_name,input.displayName);
  assert.deepEqual(Object.keys(created).sort(),['display_name','email','id']);
  assert.ok(!JSON.stringify(created).includes(input.password));

  const stored=await pool.query<{
    password_hash:string;
  }>('SELECT password_hash FROM users WHERE id=$1',[created.id]);
  assert.notEqual(stored.rows[0].password_hash,input.password);
  assert.deepEqual(await authenticateAccount(email,input.password),created);
  await assert.rejects(authenticateAccount(email,'incorrect-password'),error=>{
    const err=error as {statusCode?:number;message?:string};
    return err.statusCode===401&&err.message==='账号或密码错误';
  });
  await assert.rejects(authenticateAccount('missing-'+email,input.password),
    /账号或密码错误/);

  const ownTenants=await listAccountTenants(created.id);
  assert.equal(ownTenants.tenants.length,1);
  assert.equal(ownTenants.tenants[0].role,'admin');
  const ownTenantId=ownTenants.tenants[0].id;
  assert.equal((await getAccountProfile(created.id)).user.is_system_admin,false);

  const foreignUser=await registerAccount({
    email:'foreign-'+email,displayName:'Foreign Identity',password:input.password,
  });
  const foreignTenants=await listAccountTenants(foreignUser.id);
  assert.equal(foreignTenants.tenants.length,1);
  assert.ok(foreignTenants.tenants[0].id!==ownTenantId);
  assert.deepEqual((await listAccountTenants(created.id)).tenants.map(x=>x.id),
    [ownTenantId],'Tenant navigation cannot reveal unrelated memberships');

  await assert.rejects(registerAccount(input),error=>
    (error as {code?:string}).code==='23505',
    'A duplicate account cannot silently create a second tenant');
  assert.equal((await listAccountTenants(created.id)).tenants.length,1);

  await pool.query('UPDATE users SET is_system_admin=TRUE WHERE id=$1',[created.id]);
  assert.equal((await getAccountProfile(created.id)).user.is_system_admin,true,
    'Admin visibility must be read from current authoritative user status');
  await pool.query('UPDATE users SET is_system_admin=FALSE WHERE id=$1',[created.id]);
  assert.equal((await getAccountProfile(created.id)).user.is_system_admin,false);

  await pool.query('DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2',
    [ownTenantId,created.id]);
  assert.equal((await listAccountTenants(created.id)).tenants.length,0,
    'Tenant removal must immediately revoke navigation even with a live session');
  const rejoined=await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'member') RETURNING role`,[ownTenantId,created.id]);
  assert.equal(rejoined.rows[0].role,'member');
  assert.equal((await listAccountTenants(created.id)).tenants[0].role,'member');

  await assert.rejects(getAccountProfile(randomUUID()),/请先登录/);
  console.log('Account Core: registration, hashed credentials, scoped tenants, revocation, admin grant');
}finally{
  await pool.end();
}
