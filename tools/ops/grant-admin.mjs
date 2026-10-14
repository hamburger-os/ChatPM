#!/usr/bin/env node
// Local operator-only bootstrap. Never exposed through HTTP or project roles.
import 'dotenv/config';
import pg from 'pg';
const emailArg=process.argv.find(x=>x.startsWith('--email='));
const email=emailArg?.slice('--email='.length)?.trim().toLowerCase();
if(!process.argv.includes('--confirm')||!email||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
  console.error('Usage: npm run admin:grant -- --email=admin@example.com --confirm');
  process.exit(2);
}
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
  const client=await pool.connect();
  try{
    await client.query('BEGIN');
    const result=await client.query(`UPDATE users SET is_system_admin=TRUE WHERE email=$1
      RETURNING id,email`,[email]);
    if(!result.rowCount)throw new Error('User not found. Register account first.');
    await client.query(`INSERT INTO system_audit_entries(actor_id,action,target_id,metadata)
      VALUES(NULL,'system.admin_granted',$1,$2)`,
      [result.rows[0].id,JSON.stringify({via:'local-operator',email})]);
    await client.query('COMMIT');
    console.log('System administrator granted to registered account '+email);
  }catch(e){
    await client.query('ROLLBACK');throw e;
  }finally{client.release();}
}catch(e){console.error(e instanceof Error?e.message:'Administrator bootstrap failed');process.exitCode=1;}
finally{await pool.end();}
