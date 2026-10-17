import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {pool} from '../../packages/core/src/db.ts';
import {renewEventLease} from '../../packages/core/src/outbox.ts';
import {
  OUTBOX_HEALTH_SQL,OUTBOX_QUEUE_THRESHOLDS,evaluateHealth,
} from '../ops/doctor.mjs';

const seedId=randomUUID();
let projectId=null;
const metrics=async()=>{
  const {rows}=await pool.query(OUTBOX_HEALTH_SQL,[
    OUTBOX_QUEUE_THRESHOLDS.overdueMinutes,
    OUTBOX_QUEUE_THRESHOLDS.stalledClaimMinutes,
  ]);
  return rows[0];
};
try{
  const user=(await pool.query(`
    INSERT INTO users(email,display_name,password_hash)
    VALUES($1,'Queue diagnostic integration','unused') RETURNING id
  `,['queue-diagnostic-'+seedId+'@example.test'])).rows[0].id;
  const tenant=(await pool.query(`
    INSERT INTO tenants(name) VALUES('Queue diagnostics test') RETURNING id
  `)).rows[0].id;
  const project=(await pool.query(`
    WITH created AS (
      INSERT INTO projects(tenant_id,name)
      VALUES($1,'Outbox diagnostics') RETURNING id
    ), seeded_owner AS (
      INSERT INTO project_members(project_id,user_id,role)
      SELECT id,$2,'owner' FROM created RETURNING project_id
    ) SELECT id FROM created
  `,[tenant,user])).rows[0].id;
  projectId=project;
  const baseline=await metrics();

  // SQL is the EXACT production Doctor query. Age is expressed relative to
  // PostgreSQL NOW(), not CI machine time or duplicated JS queue predicates.
  async function insert({
    dueMinutes,claimedAgeMinutes=null,attempts=0,errorCode=null,
    dead=false,processed=false,
  }){
    const {rows}=await pool.query(`
      INSERT INTO outbox_events(project_id,kind,next_attempt_at,
        claimed_at,claim_token,attempts,last_error_code,dead_at,processed_at)
      VALUES($1,'message.created',NOW()-($2::int * INTERVAL '1 minute'),
        CASE WHEN $3::int IS NULL THEN NULL
             ELSE NOW()-($3::int * INTERVAL '1 minute') END,
        CASE WHEN $3::int IS NULL THEN NULL ELSE gen_random_uuid() END,
        $4,$5,
        CASE WHEN $6::boolean THEN NOW() ELSE NULL END,
        CASE WHEN $7::boolean THEN NOW() ELSE NULL END)
      RETURNING id,project_id,claim_token
    `,[project,dueMinutes,claimedAgeMinutes,attempts,errorCode,dead,processed]);
    return rows[0];
  }

  await insert({dueMinutes:-120,attempts:1,errorCode:'AI_DAILY_BUDGET'});
  const active=await insert({dueMinutes:20,claimedAgeMinutes:1,attempts:1});
  assert.equal(await renewEventLease(active),true,
    'A live model owner renews the current token without consuming an attempt');
  assert.deepEqual(await metrics(),baseline,
    'Long-running but heartbeating model and intentional future retry are not queued failures');

  await insert({dueMinutes:20});
  await insert({dueMinutes:20,claimedAgeMinutes:12,attempts:1});
  for(let n=0;n<10;n++)await insert({
    dueMinutes:1,attempts:2,errorCode:'MODEL_HTTP_429',
  });
  await insert({dueMinutes:20,attempts:8,dead:true});
  await insert({dueMinutes:20,attempts:1,processed:true});

  const observed=await metrics();
  const delta={
    overdue:observed.overdue-baseline.overdue,
    stalled_claims:observed.stalled_claims-baseline.stalled_claims,
    retry_ready:observed.retry_ready-baseline.retry_ready,
    ready:observed.ready-baseline.ready,
    dead:observed.dead-baseline.dead,
  };
  assert.deepEqual(delta,{
    overdue:1,stalled_claims:1,retry_ready:10,ready:11,dead:1,
  },'One overdue queue item, one crashed claim, ten ready retries and a dead letter are distinct');

  const healthyLane={heartbeatAgeSec:1,successAgeSec:1,failureAgeSec:null};
  const diagnosis=evaluateHealth({
    apiOk:true,
    lanes:{events:healthyLane,reminders:healthyLane,reports:healthyLane},
    overdue:delta.overdue,stalledClaims:delta.stalled_claims,
    retryReady:delta.retry_ready,dead:delta.dead,
    migrations:['029_worker_lane_health.sql'],
  });
  assert.deepEqual(diagnosis.issues,[
    'OUTBOX_OVERDUE','OUTBOX_STALLED_CLAIM',
    'OUTBOX_RETRY_READY_PRESSURE','OUTBOX_DEAD_LETTER',
  ]);

  // Isolated fixture clean-up restores original operational counters. No
  // synthetic cleanup updates to real events or global diagnostic tables.
  await pool.query('DELETE FROM outbox_events WHERE project_id=$1',[project]);
  assert.deepEqual(await metrics(),baseline,
    'Recovery clears the operational queue signals without a duplicate state table');
  console.log('Doctor Outbox: active lease excluded, due retry pressure, stalled claims, dead-letter recovery');
}finally{
  if(projectId)await pool.query('DELETE FROM outbox_events WHERE project_id=$1',[projectId]);
  await pool.end();
}
