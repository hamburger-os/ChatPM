#!/usr/bin/env node
// Private read-only diagnostics. Run locally or inside the API container, not over public HTTP.
import 'dotenv/config';
import pg from 'pg';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function evaluateHealth({ apiOk, heartbeatAgeSec, successAgeSec, overdue, dead, migrations }) {
  const issues = [];
  if (!apiOk) issues.push('API_UNREACHABLE');
  if (heartbeatAgeSec === null || heartbeatAgeSec > 180) issues.push('WORKER_HEARTBEAT_STALE');
  if (successAgeSec === null || successAgeSec > 300) issues.push('WORKER_TICK_NOT_SUCCESSFUL');
  if (overdue > 0) issues.push('OUTBOX_OVERDUE');
  if (dead > 0) issues.push('OUTBOX_DEAD_LETTER');
  if (!migrations.includes('004_worker_health.sql')) issues.push('DATABASE_NOT_MIGRATED');
  return { ok: issues.length === 0, issues };
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
      pool.query(`SELECT EXTRACT(EPOCH FROM (NOW()-last_seen_at))::integer AS seen_age,
        EXTRACT(EPOCH FROM (NOW()-last_success_at))::integer AS success_age
        FROM worker_health WHERE name='default'`),
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_at IS NULL
          AND next_attempt_at < NOW()-INTERVAL '10 minutes')::integer AS overdue,
        COUNT(*) FILTER (WHERE dead_at IS NOT NULL)::integer AS dead
        FROM outbox_events`),
      pool.query('SELECT version FROM schema_migrations ORDER BY version'),
    ]);
    const row = heartbeat.rows[0];
    const data = {
      apiOk,
      heartbeatAgeSec: row?.seen_age ?? null,
      successAgeSec: row?.success_age ?? null,
      overdue: events.rows[0]?.overdue ?? 0,
      dead: events.rows[0]?.dead ?? 0,
      migrations: history.rows.map(r => r.version),
    };
    const summary = evaluateHealth(data);
    console.log(JSON.stringify({
      status: summary.ok ? 'healthy' : 'unhealthy',
      issues: summary.issues,
      api: apiOk ? 'ok' : 'unavailable',
      workerHeartbeatAgeSeconds: data.heartbeatAgeSec,
      workerSuccessfulTickAgeSeconds: data.successAgeSec,
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
