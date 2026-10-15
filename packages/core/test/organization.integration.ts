import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.ts';
import { organizationCommand } from '../src/organization-commands.ts';

const suffix=randomUUID();
try{
  const actor=(await pool.query(
    'INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',
    ['governance-admin-'+suffix+'@example.com','Gov Admin','unused'])).rows[0].id as string;
  const member=(await pool.query(
    'INSERT INTO users(email,display_name,password_hash) VALUES($1,$2,$3) RETURNING id',
    ['governance-member-'+suffix+'@example.com','Gov Member','unused'])).rows[0].id as string;
  const tenantId=(await pool.query(
    "INSERT INTO tenants(name) VALUES('Governance Integration') RETURNING id")).rows[0].id as string;
  await pool.query(`INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member')`,[tenantId,actor,member]);

  const firstKey=randomUUID();
  const firstIntent={idempotencyKey:firstKey,payload:{name:'Verified Department'}};
  const department=await organizationCommand(tenantId,actor,'department.created',
    firstIntent,async db=>{
    const {rows}=await db.query(`INSERT INTO departments(tenant_id,name)
      VALUES($1,'Verified Department') RETURNING id,name`,[tenantId]);
    return {value:rows[0] as {id:string;name:string},
      targetId:rows[0].id as string,metadata:{source:'integration'}};
  });
  assert.equal(department.name,'Verified Department');
  const replay=await organizationCommand(tenantId,actor,'department.created',
    firstIntent,async()=>{throw new Error('Completed command replay must not invoke mutation');});
  assert.deepEqual(replay,department);
  await assert.rejects(organizationCommand(tenantId,actor,'department.created',
    {idempotencyKey:firstKey,payload:{name:'Other Department'}},
    async()=>{throw new Error('hash conflict must not mutate');}),/幂等键/);
  const rootReceipt=await pool.query(`SELECT result,payload_hash FROM tenant_command_receipts
    WHERE tenant_id=$1 AND actor_id=$2 AND kind='department.created'
      AND idempotency_key=$3`,[tenantId,actor,firstKey]);
  assert.equal(rootReceipt.rowCount,1,'Tenant-scoped receipt must be durable');
  assert.deepEqual(rootReceipt.rows[0].result,department);
  const audits=await pool.query(`SELECT actor_id,action,target_id,metadata
    FROM organization_audit_entries WHERE tenant_id=$1`,[tenantId]);
  assert.equal(audits.rows.length,1);
  assert.equal(audits.rows[0].actor_id,actor);
  assert.equal(audits.rows[0].target_id,department.id);
  assert.equal(audits.rows[0].action,'department.created');
  assert.deepEqual(audits.rows[0].metadata,{source:'integration'});

  // A business error after a write must leave neither domain state nor audit.
  await assert.rejects(
    organizationCommand(tenantId,actor,'department.created',{idempotencyKey:randomUUID(),payload:{name:'Rolled Back'}},async db=>{
      await db.query(`INSERT INTO departments(tenant_id,name)
        VALUES($1,'Rolled Back')`,[tenantId]);
      throw new Error('business failure');
    }),/business failure/);

  // An audit constraint failure must also roll back the preceding domain write.
  await assert.rejects(
    organizationCommand(tenantId,actor,'department.created',{idempotencyKey:randomUUID(),payload:{name:'Audit Failed'}},async db=>{
      await db.query(`INSERT INTO departments(tenant_id,name)
        VALUES($1,'Audit Failed')`,[tenantId]);
      return {value:true,targetId:'invalid-uuid'};
    }));
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM departments
    WHERE tenant_id=$1`,[tenantId])).rows[0].count,1);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM organization_audit_entries
    WHERE tenant_id=$1`,[tenantId])).rows[0].count,1);

  // A member has no write permission even when the callback is otherwise valid.
  await assert.rejects(
    organizationCommand(tenantId,member,'department.created',{idempotencyKey:randomUUID(),payload:{name:'Unauthorized'}},async db=>{
      await db.query(`INSERT INTO departments(tenant_id,name)
        VALUES($1,'Unauthorized')`,[tenantId]);
      return {value:true,targetId:null};
    }),/没有该组织的管理权限/);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM departments
    WHERE tenant_id=$1`,[tenantId])).rows[0].count,1);

  // Rechecking inside the transaction denies a previously authorized actor
  // after that actor loses the admin role.
  await pool.query("UPDATE tenant_members SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
    [tenantId,member]);
  await pool.query("UPDATE tenant_members SET role='member' WHERE tenant_id=$1 AND user_id=$2",
    [tenantId,actor]);
  await assert.rejects(
    organizationCommand(tenantId,actor,'portfolio.created',{idempotencyKey:randomUUID(),payload:{name:'Stale Admin'}},async db=>{
      await db.query("INSERT INTO portfolios(tenant_id,name) VALUES($1,'Stale Admin')",
        [tenantId]);
      return {value:true,targetId:null};
    }),/没有该组织的管理权限/);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM portfolios WHERE tenant_id=$1',
    [tenantId])).rows[0].count,0);
  console.log('Organization governance integration passed: audit, rollback, authz and revocation');
}finally{
  await pool.end();
}
