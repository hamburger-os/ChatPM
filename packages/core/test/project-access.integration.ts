import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.ts';
import { lockProjectAccess } from '../src/identity/project-access.ts';
import { assertProject } from '../src/permissions.ts';

const marker=randomUUID();
const {rows:users}=await pool.query(
  "INSERT INTO users(email,display_name,password_hash) VALUES($1,'Role Lock Test','unused') RETURNING id",
  ['role-lock-'+marker+'@example.com']);
const {rows:tenants}=await pool.query(
  "INSERT INTO tenants(name) VALUES('Role locking test') RETURNING id");
const actorId=users[0].id as string,tenantId=tenants[0].id as string;
const {rows:projects}=await pool.query(
  "INSERT INTO projects(tenant_id,name,owner_id) VALUES($1,'Role lock test',$2) RETURNING id",
  [tenantId,actorId]);
const projectId=projects[0].id as string;
await pool.query(
  "INSERT INTO tenant_members(tenant_id,user_id,role) VALUES($1,$2,'admin')",
  [tenantId,actorId]);
await pool.query(
  "INSERT INTO project_members(project_id,user_id,role) VALUES($1,$2,'manager')",
  [projectId,actorId]);

const a=await pool.connect(),b=await pool.connect();
try{
  await a.query('BEGIN');
  const previous=await lockProjectAccess(a,projectId,actorId);
  assert.deepEqual(previous,{tenantId,role:'manager'});
  assertProject(previous.role,'task.create');

  await b.query('BEGIN');
  await b.query("SET LOCAL lock_timeout='150ms'");
  await assert.rejects(
    b.query("UPDATE project_members SET role='observer' WHERE project_id=$1 AND user_id=$2",
      [projectId,actorId]),
    (e:unknown)=>(e as {code?:string}).code==='55P03',
    'Revoking a role must wait for an ongoing authorized transaction');
  await b.query('ROLLBACK');
  await a.query('COMMIT');

  await b.query("UPDATE project_members SET role='observer' WHERE project_id=$1 AND user_id=$2",
    [projectId,actorId]);
  await a.query('BEGIN');
  const current=await lockProjectAccess(a,projectId,actorId);
  assert.equal(current.role,'observer');
  assert.throws(()=>assertProject(current.role,'task.create'),/没有执行该操作的权限/);
  await a.query('COMMIT');

  // An organization revocation is checked independently of project role.
  await pool.query("DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2",
    [tenantId,actorId]);
  await assert.rejects(lockProjectAccess(a,projectId,actorId),
    /项目不存在或无权限/);
  console.log('Transaction-scoped role and tenant revocation integration passed');
}finally{
  try{await a.query('ROLLBACK');}catch{}
  try{await b.query('ROLLBACK');}catch{}
  a.release();b.release();
  await pool.end();
}
