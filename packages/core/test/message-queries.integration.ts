import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {listProjectMessages} from '../src/conversation/message-queries.ts';

const seed=randomUUID();
try{
  async function user(label:string){
    return (await pool.query<{id:string}>(`
      INSERT INTO users(email,display_name,password_hash)
      VALUES($1,$2,'unused') RETURNING id`,
    [label+'-'+seed+'@example.test',label])).rows[0].id;
  }
  const owner=await user('messages-owner');
  const observer=await user('messages-observer');
  const outsider=await user('messages-outsider');
  const tenant=(await pool.query<{id:string}>(
    "INSERT INTO tenants(name) VALUES('Message read scope') RETURNING id")).rows[0].id;
  const foreign=(await pool.query<{id:string}>(
    "INSERT INTO tenants(name) VALUES('Message read outsider') RETURNING id")).rows[0].id;
  await pool.query(`
    INSERT INTO tenant_members(tenant_id,user_id,role)
    VALUES($1,$2,'admin'),($1,$3,'member'),($4,$5,'admin')`,
    [tenant,owner,observer,foreign,outsider]);
  const project=(await pool.query<{id:string}>(`
    WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Message cursor') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,[tenant,owner])).rows[0].id;
  const other=(await pool.query<{id:string}>(`
    WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Foreign message cursor') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    )
    SELECT id FROM created`,
    [foreign,outsider])).rows[0].id;
  await pool.query(`
    INSERT INTO project_members(project_id,user_id,role)
    VALUES($1,$2,'owner'),($1,$3,'observer'),($4,$5,'owner') ON CONFLICT DO NOTHING`,
    [project,owner,observer,other,outsider]);
  const {rows:inserted}=await pool.query<{seq:string}>(`
    INSERT INTO messages(project_id,author_id,kind,content,client_nonce)
    SELECT $1,$2,'user','Message '||n,'message-cursor-'||$3||'-'||n
    FROM generate_series(1,225) n RETURNING seq`,[project,owner,seed]);
  const seqs=inserted.map(m=>BigInt(m.seq)).sort((a,b)=>a<b?-1:a>b?1:0);
  const recent=await listProjectMessages(project,observer,{after:0});
  assert.equal(recent.messages.length,200);
  assert.equal(recent.hasMore,true);
  assert.equal(BigInt(recent.messages[0].seq),seqs[25]);
  assert.equal(BigInt(recent.messages[199].seq),seqs[224]);
  const older=await listProjectMessages(project,owner,{
    before:Number(recent.oldestCursor),
  });
  assert.equal(older.messages.length,25);
  assert.equal(older.hasMore,false);
  assert.equal(BigInt(older.messages[0].seq),seqs[0]);
  assert.equal(BigInt(older.messages[24].seq),seqs[24]);
  const forward=await listProjectMessages(project,observer,{
    after:Number(seqs[0]),limit:20,
  });
  assert.equal(forward.messages.length,20);
  assert.equal(forward.hasMore,true);
  assert.equal(BigInt(forward.messages[0].seq),seqs[1]);
  assert.equal(BigInt(forward.messages[19].seq),seqs[20]);
  const next=await listProjectMessages(project,observer,{
    after:Number(forward.newestCursor),limit:20,
  });
  assert.equal(BigInt(next.messages[0].seq),seqs[21]);
  assert.equal((await listProjectMessages(project,owner,{
    after:Number(seqs[224]),
  })).messages.length,0);
  await assert.rejects(listProjectMessages(project,outsider,{after:0}),
    /项目不存在或无权限/);
  await assert.rejects(listProjectMessages(other,owner,{after:0}),
    /项目不存在或无权限/);
  await assert.rejects(listProjectMessages(project,owner,{limit:201}),
    /消息游标不合法/);
  await assert.rejects(listProjectMessages(project,owner,{after:-1}),
    /消息游标不合法/);
  await pool.query('DELETE FROM tenant_members WHERE tenant_id=$1 AND user_id=$2',
    [tenant,observer]);
  await assert.rejects(listProjectMessages(project,observer,{after:0}),
    /项目不存在或无权限/);
  await assert.rejects(listProjectMessages(project,observer,{
    after:Number(seqs[210]),
  }),/项目不存在或无权限/);
  await assert.rejects(listProjectMessages(project,observer,{
    before:Number(seqs[210]),
  }),/项目不存在或无权限/);
  console.log('Message query: history, ordered delta, role, tenant and revocation');
}finally{
  await pool.end();
}
