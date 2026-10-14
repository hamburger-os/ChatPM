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

  const department=await organizationCommand(tenantId,actor,'department.created',async db=>{
    const {rows}=await db.query(`INSERT INTO departments(tenant_id,name)
      VALUES($1,'Verified Department') RETURNING id,name`,[tenantId]);
    return {value:rows[0] as {id:string;name:string},
      targetId:rows[0].id as string,metadata:{source:'integration'}};
  });
  assert.equal(department.name,'Verified Department');
  const audits=await pool.query(`SELECT actor_id,action,target_id,metadata
    FROM organization_audit_entries WHERE tenant_id=$1`,[tenantId]);
  assert.equal(audits.rows.length,1);
  assert.equal(audits.rows[0].actor_id,actor);
  assert.equal(audits.rows[0].target_id,department.id);
  assert.equal(audits.rows[0].action,'department.created');
  assert.deepEqual(audits.rows[0].metadata,{source:'integration'});

  // A business error after a write must leave neither domain state nor audit.
  await assert.rejects(
    organizationCommand(tenantId,actor,'department.created',async db=>{
      await db.query(`INSERT INTO departments(tenant_id,name)
        VALUES($1,'Rolled Back')`,[tenantId]);
      throw new Error('business failure');
    }),/business failure/);

  // An audit constraint failure must also roll back the preceding domain write.
  await assert.rejects(
    organizationCommand(tenantId,actor,'department.created',async db=>{
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
    organizationCommand(tenantId,member,'department.created',async db=>{
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
    organizationCommand(tenantId,actor,'portfolio.created',async db=>{
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
