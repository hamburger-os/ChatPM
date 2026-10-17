#!/usr/bin/env node
// Private read-only diagnostics. Run locally or inside the API container, not over public HTTP.
import 'dotenv/config';
import pg from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The scheduled doctor is the single source of alert age thresholds. Reports
// run every five minutes; event and reminder lanes run every fifteen seconds.
export const WORKER_LANE_THRESHOLDS={
  events:{heartbeat:180,success:300},
  reminders:{heartbeat:180,success:300},
  reports:{heartbeat:900,success:900},
};

export function evaluateHealth({apiOk,lanes,overdue,dead,migrations}){
  const issues=[];
  if(!apiOk)issues.push('API_UNREACHABLE');
  for(const [name,threshold] of Object.entries(WORKER_LANE_THRESHOLDS)){
    const lane=lanes[name];
    const code=name.toUpperCase();
    if(!lane||lane.heartbeatAgeSec===null||
       lane.heartbeatAgeSec>threshold.heartbeat)
      issues.push('WORKER_'+code+'_HEARTBEAT_STALE');
    if(!lane||lane.successAgeSec===null||
       lane.successAgeSec>threshold.success)
      issues.push('WORKER_'+code+'_TICK_NOT_SUCCESSFUL');
    if(lane?.failureAgeSec!==null&&lane?.failureAgeSec!==undefined&&
       (lane.successAgeSec===null||lane.failureAgeSec<lane.successAgeSec))
      issues.push('WORKER_'+code+'_LAST_TICK_FAILED');
  }
  if(overdue>0)issues.push('OUTBOX_OVERDUE');
  if(dead>0)issues.push('OUTBOX_DEAD_LETTER');
  if(!migrations.includes('029_worker_lane_health.sql'))
    issues.push('DATABASE_NOT_MIGRATED');
  return {ok:issues.length===0,issues};
}

/** PostgreSQL provides age values relative to the SAME database clock for
 * every lane. Unknown rows are not implicitly healthy.
 */
export function parseWorkerLanes(rows){
  const lanes={};
  for(const row of rows){
    if(!Object.hasOwn(WORKER_LANE_THRESHOLDS,row.name))continue;
    lanes[row.name]={
      heartbeatAgeSec:row.seen_age===null?null:Number(row.seen_age),
      successAgeSec:row.success_age===null?null:Number(row.success_age),
      failureAgeSec:row.failure_age===null?null:Number(row.failure_age),
    };
  }
  return lanes;
}

export async function main() {
  const host = process.env.API_HOST && !['0.0.0.0', '::'].includes(process.env.API_HOST)
    ? process.env.API_HOST : '127.0.0.1';
  const port = process.env.API_PORT || '3001';
  let apiOk = false;
  try {
    const response = await fetch('http://' + host + ':' + port + '/health', {
      signal: AbortSignal.timeout(4000),
    });
    apiOk = response.ok;
  } catch { /* API unavailable */ }

  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL || undefined,
    max: 1,
    connectionTimeoutMillis: 4000,
    query_timeout: 5000,
  });
  try {
    const [heartbeat, events, history] = await Promise.all([
      pool.query(`SELECT name,EXTRACT(EPOCH FROM (NOW()-last_seen_at))::double precision AS seen_age,
        EXTRACT(EPOCH FROM (NOW()-last_success_at))::double precision AS success_age,
        EXTRACT(EPOCH FROM (NOW()-last_failure_at))::double precision AS failure_age
        FROM worker_health`),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_at IS NULL
          AND next_attempt_at < NOW()-INTERVAL '10 minutes')::integer AS overdue,
        COUNT(*) FILTER (WHERE dead_at IS NOT NULL)::integer AS dead
        FROM outbox_events`),
      pool.query('SELECT version FROM schema_migrations ORDER BY version'),
    ]);
    const lanes=parseWorkerLanes(heartbeat.rows);
    const data = {
      apiOk,
      lanes,
      overdue: events.rows[0]?.overdue ?? 0,
      dead: events.rows[0]?.dead ?? 0,
      migrations: history.rows.map(r => r.version),
    };
    const summary = evaluateHealth(data);
    console.log(JSON.stringify({
      status: summary.ok ? 'healthy' : 'unhealthy',
      issues: summary.issues,
      api: apiOk ? 'ok' : 'unavailable',
      workerLanes: data.lanes,
      overdueEvents: data.overdue,
      deadLetters: data.dead,
      latestMigration: data.migrations.at(-1) ?? null,
    }, null, 2));
    if (!summary.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({
      status: 'unhealthy',
      issues: ['DATABASE_UNAVAILABLE_OR_SCHEMA_MISSING'],
      errorType: error instanceof Error ? error.name : 'UnknownError',
    }));
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
