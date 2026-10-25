import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../src/db.ts';
import {
  registerWecomBot,listWecomBots,listEnabledWecomBots,
  beginWecomUserBinding,beginWecomRoomBinding,revokeWecomRoomBinding,
  acceptWecomMessage,
} from '../src/im/wecom-service.ts';
import type {InboundText} from '../../im/src/contracts.ts';

process.env.IM_ENCRYPTION_KEY='ci-only-im-encryption-key-testing-123456789';
const suffix=randomUUID(),ownerEmail='im-owner-'+suffix+'@example.test';
const memberEmail='im-member-'+suffix+'@example.test';
const owner=(await pool.query<{id:string}>(`
  INSERT INTO users(email,display_name,password_hash)
  VALUES($1,'IM owner','none') RETURNING id`,[ownerEmail])).rows[0].id;
const member=(await pool.query<{id:string}>(`
  INSERT INTO users(email,display_name,password_hash)
  VALUES($1,'IM member','none') RETURNING id`,[memberEmail])).rows[0].id;
const tenant=(await pool.query<{id:string}>(`
  INSERT INTO tenants(name) VALUES('IM test tenant') RETURNING id`)).rows[0].id;
await pool.query(`INSERT INTO tenant_members(tenant_id,user_id,role)
  VALUES($1,$2,'admin'),($1,$3,'member')`,[tenant,owner,member]);
const project=(await pool.query<{id:string}>(`
  WITH created AS (
    INSERT INTO projects(tenant_id,name) VALUES($1,'IM project') RETURNING id
  ), seeded AS (
    INSERT INTO project_members(project_id,user_id,role)
    SELECT id,$2,'owner' FROM created RETURNING project_id
  ) SELECT id FROM created`,[tenant,owner])).rows[0].id;
await pool.query(`INSERT INTO project_members(project_id,user_id,role)
  VALUES($1,$2,'member')`,[project,member]);

function event(
  kind:'group'|'direct',user:string,text:string,messageId:string,botId:string,
):InboundText{
  return {channel:'wecom',accountId:botId,externalMessageId:messageId,
    externalActorId:user,
    route:{kind,externalConversationId:kind==='group'?'wecom-room-1':user},
    text,sourceCreatedAt:null};
}
try{
  const botId='bot-'+suffix;
  await assert.rejects(registerWecomBot(tenant,member,{
    botId,secret:'must-remain-confidential',idempotencyKey:randomUUID(),
  }),/没有该组织的管理权限/);
  const key=randomUUID();
  const bot=await registerWecomBot(tenant,owner,{
    botId,secret:'must-remain-confidential',idempotencyKey:key,
  });
  assert.deepEqual(await registerWecomBot(tenant,owner,{
    botId,secret:'must-remain-confidential',idempotencyKey:key,
  }),bot,'admin retries must reuse the same persisted bot');
  assert.equal((await listWecomBots(tenant,owner)).bots.length,1);
  await assert.rejects(listWecomBots(tenant,member),/没有该组织的管理权限/);
  assert.equal((await listEnabledWecomBots()).find(x=>x.id===bot.id)?.secret,
    'must-remain-confidential');

  const ownerToken=await beginWecomUserBinding(bot.id,owner);
  assert.deepEqual(await acceptWecomMessage(bot.id,event(
    'direct','external-owner',ownerToken.command,'m-bind-owner',botId)),
    {status:'user-bound'});
  assert.deepEqual(await acceptWecomMessage(bot.id,event(
    'direct','external-owner',ownerToken.command,'m-bind-owner-replay',botId)),
    {status:'ignored'},'single-use binding code cannot be replayed');
  const memberToken=await beginWecomUserBinding(bot.id,member);
  assert.deepEqual(await acceptWecomMessage(bot.id,event(
    'direct','external-member',memberToken.command,'m-bind-member',botId)),
    {status:'user-bound'});
  const room=await beginWecomRoomBinding(project,bot.id,owner);
  assert.deepEqual(await acceptWecomMessage(bot.id,event(
    'group','external-member','@项目经理 '+room.command,'m-hijack',botId)),
    {status:'ignored'},'only bound project owner may activate the group');
  assert.deepEqual(await acceptWecomMessage(bot.id,event(
    'group','external-owner','@项目经理 '+room.command,'m-room',botId)),
    {status:'room-bound'});
  const inbound=event('group','external-member','任务延期两天','m-1',botId);
  assert.deepEqual(await acceptWecomMessage(bot.id,inbound),{status:'stored'});
  assert.deepEqual(await acceptWecomMessage(bot.id,inbound),{status:'duplicate'});
  const counts=await pool.query<{count:string}>(`
    SELECT COUNT(*)::text AS count FROM im_inbox WHERE project_id=$1`,[project]);
  assert.equal(counts.rows[0].count,'1');
  const messages=await pool.query<{count:string}>(`
    SELECT COUNT(*)::text AS count FROM messages WHERE project_id=$1`,[project]);
  assert.equal(messages.rows[0].count,'1');
  const events=await pool.query<{count:string}>(`
    SELECT COUNT(*)::text AS count FROM outbox_events
    WHERE project_id=$1 AND kind='message.created'`,[project]);
  assert.equal(events.rows[0].count,'1');
  await pool.query(`UPDATE project_members SET role='observer'
    WHERE project_id=$1 AND user_id=$2`,[project,member]);
  await assert.rejects(acceptWecomMessage(bot.id,event(
    'group','external-member','没有权限','m-2',botId)),/没有执行该操作的权限/);
  await assert.rejects(revokeWecomRoomBinding(project,bot.id,member),
    /没有执行该操作的权限/);
  assert.deepEqual(await revokeWecomRoomBinding(project,bot.id,owner),{ok:true});
  assert.deepEqual(await acceptWecomMessage(bot.id,event(
    'group','external-owner','revoked room','m-3',botId)),{status:'ignored'});
  assert.deepEqual(await acceptWecomMessage(bot.id,event(
    'group','external-owner','wrong bot','m-4','different-bot')),{status:'ignored'});
}catch(err){
  // The first binding attempt itself must return the new persisted authorization.
  throw err;
}finally{
  await pool.query('DELETE FROM projects WHERE id=$1',[project]);
  await pool.query('DELETE FROM tenants WHERE id=$1',[tenant]);
  await pool.query('DELETE FROM users WHERE id IN ($1,$2)',[owner,member]);
  await pool.end();
}
