import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {pool,transaction} from '../src/db.ts';
import {enforceRegistration} from '../src/identity/registration-policy.ts';

const token='f'.repeat(64);
const id=randomUUID();
const userIds:string[]=[];
try{
  const existing=await pool.query('SELECT 1 FROM users LIMIT 1');
  assert.equal(existing.rowCount,0,
    'Bootstrap concurrency integration needs a clean, newly migrated test database');
  const register=async(email:string)=>{
    return transaction(async db=>{
      await enforceRegistration(db,'bootstrap',token,token);
      // Force the second contender to wait for the transaction-scoped lock.
      await delay(100);
      const created=await db.query<{id:string}>(
        "INSERT INTO users(email,display_name,password_hash) VALUES($1,'Bootstrap Integration','unused') RETURNING id",
        [email]);
      return created.rows[0].id;
    });
  };
  await assert.rejects(transaction(db=>enforceRegistration(db,'bootstrap',
    '0'.repeat(64),token)),/公开注册已关闭/,
    'A guessed bootstrap token must not create a first user');
  const outcomes=await Promise.allSettled([
    register('bootstrap-one-'+id+'@example.test'),
    register('bootstrap-two-'+id+'@example.test'),
  ]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
  const successful=outcomes.find(x=>x.status==='fulfilled') as PromiseFulfilledResult<string>;
  userIds.push(successful.value);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n,1);
  await assert.rejects(transaction(db=>enforceRegistration(db,'bootstrap',
    token,token)),/公开注册已关闭/,'Bootstrap may never reopen after first user');
  console.log('Bootstrap concurrency integration passed: only one operator-authorized initializer');
}finally{
  for(const uid of userIds)await pool.query('DELETE FROM users WHERE id=$1',[uid]);
  await pool.end();
}
