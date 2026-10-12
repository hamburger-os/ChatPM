import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pool } from '../src/db.ts';
import { claimEvents, failEvent, finishEvent, deadEvents, MAX_EVENT_ATTEMPTS } from '../src/outbox.ts';
import { DailyAIBudgetExceeded } from '../src/ai-provider.ts';
import { referencedCandidate } from '../src/clarification.ts';

const uuid=randomUUID();
assert.equal(referencedCandidate('请回复【候选:'+uuid+'】'),uuid);
assert.equal(referencedCandidate('其他无引用消息'),null);

try {
  const user=(await pool.query(
    `INSERT INTO users(email,display_name,password_hash) VALUES($1,'Tester','unused') RETURNING id`,
    ['outbox-'+uuid+'@example.com'])).rows[0];
  const tenant=(await pool.query(
    `INSERT INTO tenants(name) VALUES('Outbox Test') RETURNING id`)).rows[0];
  const project=(await pool.query(
    `INSERT INTO projects(tenant_id,name,owner_id) VALUES($1,'Retry test',$2) RETURNING id`,
    [tenant.id,user.id])).rows[0];
  const event=(await pool.query(
    `INSERT INTO outbox_events(project_id,kind) VALUES($1,'message.created') RETURNING id`,
    [project.id])).rows[0];
  for(let n=1;n<=MAX_EVENT_ATTEMPTS;n++){
    const claimed=await claimEvents(1);
    assert.equal(claimed.length,1,'An event should remain claimable before retry limit');
    assert.equal(claimed[0].id,event.id);
    assert.equal(claimed[0].attempts,n);
    await failEvent(claimed[0],new Error('sensitive secret should never persist'));
    const {rows}=await pool.query(
      'SELECT attempts,last_error_code,dead_at,next_attempt_at FROM outbox_events WHERE id=$1',[event.id]);
    assert.equal(rows[0].last_error_code,'PROCESSING_ERROR');
    if(n<MAX_EVENT_ATTEMPTS){
      assert.equal(rows[0].dead_at,null);
      assert.ok(new Date(rows[0].next_attempt_at)>new Date());
      await pool.query("UPDATE outbox_events SET next_attempt_at=NOW()-INTERVAL '1 minute' WHERE id=$1",
        [event.id]);
    }else assert.ok(rows[0].dead_at);
  }
  assert.equal((await claimEvents(1)).length,0,'Dead events must not be claimed');
  assert.equal((await deadEvents(project.id)).length,1);
  await pool.query(`UPDATE outbox_events SET attempts=0,dead_at=NULL,claimed_at=NULL,
    last_error_code=NULL,next_attempt_at=NOW() WHERE id=$1`,[event.id]);
  const replay=(await claimEvents(1))[0];
  assert.equal(replay.id,event.id);
  await finishEvent(replay);
  assert.equal((await claimEvents(1)).length,0);
  assert.equal((await deadEvents(project.id)).length,0);

  const quotaEvent=(await pool.query(
    `INSERT INTO outbox_events(project_id,kind) VALUES($1,'message.created') RETURNING id`,
    [project.id])).rows[0];
  const quota=(await claimEvents(1))[0];
  assert.equal(quota.id,quotaEvent.id);
  await failEvent(quota,new DailyAIBudgetExceeded());
  const quotaState=(await pool.query(
    'SELECT attempts,dead_at,next_attempt_at,last_error_code FROM outbox_events WHERE id=$1',
    [quota.id])).rows[0];
  assert.equal(quotaState.attempts,0);
  assert.equal(quotaState.dead_at,null);
  assert.equal(quotaState.last_error_code,'AI_DAILY_BUDGET');
  assert.ok(new Date(quotaState.next_attempt_at)>new Date());

  // A stale worker must not acknowledge work after its lease is reassigned.
  const leaseEvent=(await pool.query(
    "INSERT INTO outbox_events(project_id,kind) VALUES($1,'message.created') RETURNING id",
    [project.id])).rows[0];
  const oldLease=(await claimEvents(1))[0];
  assert.equal(oldLease.id,leaseEvent.id);
  await pool.query("UPDATE outbox_events SET claimed_at=NOW()-INTERVAL '7 minutes' WHERE id=$1",
    [leaseEvent.id]);
  const newLease=(await claimEvents(1))[0];
  assert.equal(newLease.id,leaseEvent.id);
  assert.notEqual(newLease.claim_token,oldLease.claim_token);
  await finishEvent(oldLease);
  const stillPending=(await pool.query(
    'SELECT processed_at FROM outbox_events WHERE id=$1',[leaseEvent.id])).rows[0];
  assert.equal(stillPending.processed_at,null);
  await finishEvent(newLease);
  assert.ok((await pool.query(
    'SELECT processed_at FROM outbox_events WHERE id=$1',[leaseEvent.id])).rows[0].processed_at);

  const crashed=(await pool.query(
    `INSERT INTO outbox_events(project_id,kind,attempts,claimed_at)
     VALUES($1,'message.created',8,NOW()-INTERVAL '10 minutes') RETURNING id`,
    [project.id])).rows[0];
  await claimEvents(1);
  const recovered=(await pool.query(
    'SELECT dead_at,last_error_code FROM outbox_events WHERE id=$1',[crashed.id])).rows[0];
  assert.ok(recovered.dead_at,'An abandoned final attempt must be quarantined');
  assert.equal(recovered.last_error_code,'LEASE_EXPIRED');
  console.log('Outbox integration passed: retry backoff, dead letter, recovery, quota and replay');
}finally{
  await pool.end();
}
