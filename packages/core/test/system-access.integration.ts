import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.ts';
import { systemAdminTransaction } from '../src/identity/system-access.ts';

const marker=randomUUID();
const user=(await pool.query<{id:string}>(`
  INSERT INTO users(email,display_name,password_hash,is_system_admin)
  VALUES($1,'Platform test','unused',TRUE) RETURNING id
`,['platform-grant-'+marker+'@example.com'])).rows[0];
const actorId=user.id;
let release!:()=>void;
let acquired!:()=>void;
const gate=new Promise<void>(resolve=>{release=resolve;});
const ready=new Promise<void>(resolve=>{acquired=resolve;});
const pending=systemAdminTransaction(actorId,async db=>{
  acquired();
  await gate;
  await db.query(`INSERT INTO system_audit_entries(actor_id,action)
    VALUES($1,'platform.grant_checked')`,[actorId]);
  return 'committed';
});
const other=await pool.connect();
try{
  await ready;
  await other.query('BEGIN');
  await other.query("SET LOCAL lock_timeout='200ms'");
  await assert.rejects(
    other.query("UPDATE users SET is_system_admin=FALSE WHERE id=$1",[actorId]),
    (e:unknown)=>(e as {code?:string}).code==='55P03',
    'Revoking platform admin must wait for a running privileged transaction');
  await other.query('ROLLBACK');
  release();
  assert.equal(await pending,'committed');

  await pool.query('UPDATE users SET is_system_admin=FALSE WHERE id=$1',[actorId]);
  await assert.rejects(
    systemAdminTransaction(actorId,async db=>{
      await db.query(`INSERT INTO system_audit_entries(actor_id,action)
        VALUES($1,'platform.unauthorized')`,[actorId]);
    }),
    /仅系统总管理员可以执行此操作/);
  const {rows}=await pool.query<{n:number}>(`
    SELECT COUNT(*)::int AS n FROM system_audit_entries
    WHERE actor_id=$1 AND action IN ('platform.grant_checked','platform.unauthorized')
  `,[actorId]);
  assert.equal(rows[0].n,1,'Failed authorization must roll back business and audit');
  console.log('Platform admin transaction and revocation integration passed');
}finally{
  release();
  try{await other.query('ROLLBACK');}catch{}
  other.release();
  await pool.end();
}
