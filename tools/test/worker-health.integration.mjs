import assert from 'node:assert/strict';
import {pool} from '../../packages/core/src/db.ts';
import {recordWorkerHeartbeat} from '../../packages/core/src/operations/worker-heartbeat.ts';
import {evaluateHealth,parseWorkerLanes} from '../ops/doctor.mjs';

const read=async()=>{
  const {rows}=await pool.query(`
    SELECT name,
      EXTRACT(EPOCH FROM (NOW()-last_seen_at))::double precision AS seen_age,
      EXTRACT(EPOCH FROM (NOW()-last_success_at))::double precision AS success_age,
      EXTRACT(EPOCH FROM (NOW()-last_failure_at))::double precision AS failure_age
    FROM worker_health
  `);
  return parseWorkerLanes(rows);
};
const check=async()=>evaluateHealth({
  apiOk:true,lanes:await read(),overdue:0,stalledClaims:0,retryReady:0,dead:0,
  migrations:['029_worker_lane_health.sql'],
});
try{
  await pool.query("DELETE FROM worker_health");
  await assert.rejects(pool.query(`
    INSERT INTO worker_health(name,last_seen_at)
    VALUES('default',NOW())`),
    error=>error.code==='23514',
    'Single default heartbeat is forbidden by the migrated schema');

  await recordWorkerHeartbeat('events',false);
  await recordWorkerHeartbeat('reminders',true);
  await recordWorkerHeartbeat('reports',true);
  const failing=await check();
  assert.equal(failing.ok,false);
  assert.ok(failing.issues.includes('WORKER_EVENTS_TICK_NOT_SUCCESSFUL'));
  assert.ok(failing.issues.includes('WORKER_EVENTS_LAST_TICK_FAILED'));
  assert.ok(!failing.issues.some(x=>x.includes('REMINDERS')||x.includes('REPORTS')),
    'Other successful lanes cannot hide an event failure');

  await recordWorkerHeartbeat('events',true);
  const recovered=await check();
  assert.deepEqual(recovered,{ok:true,issues:[]});
  const health=await pool.query(`
    SELECT name,last_seen_at,last_success_at,last_failure_at
    FROM worker_health ORDER BY name
  `);
  assert.deepEqual(health.rows.map(x=>x.name),['events','reminders','reports']);
  assert.ok(health.rows.find(x=>x.name==='events').last_failure_at,
    'Failed tick history must remain observable after recovery');

  await pool.query(`
    UPDATE worker_health SET last_seen_at=NOW()-INTERVAL '7 minutes',
      last_success_at=NOW()-INTERVAL '7 minutes'
    WHERE name='events'`);
  const stalled=await check();
  assert.ok(stalled.issues.includes('WORKER_EVENTS_HEARTBEAT_STALE'));
  assert.ok(stalled.issues.includes('WORKER_EVENTS_TICK_NOT_SUCCESSFUL'));
  assert.ok(!stalled.issues.some(x=>x.includes('REMINDERS')||x.includes('REPORTS')));

  await pool.query("DELETE FROM worker_health WHERE name='reports'");
  const missing=await check();
  assert.ok(missing.issues.includes('WORKER_REPORTS_HEARTBEAT_STALE'));
  assert.ok(missing.issues.includes('WORKER_REPORTS_TICK_NOT_SUCCESSFUL'));
  assert.equal((await pool.query(
    "SELECT count(*)::int AS n FROM worker_health WHERE name='default'"
  )).rows[0].n,0);
  console.log('Lane health: isolated PostgreSQL heartbeats, failure, recovery, stale/missing detection');
}finally{
  await pool.query('DELETE FROM worker_health');
  await pool.end();
}
