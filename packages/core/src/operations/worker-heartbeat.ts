import { pool } from '../db.ts';

/** Operational telemetry: never a source of truth for PM-domain state. */
export async function recordWorkerHeartbeat(succeeded:boolean):Promise<void>{
  await pool.query(`INSERT INTO worker_health(name,last_seen_at,last_success_at,last_failure_at)
    VALUES('default',NOW(),CASE WHEN $1::boolean THEN NOW() ELSE NULL END,
      CASE WHEN $1::boolean THEN NULL ELSE NOW() END)
    ON CONFLICT (name) DO UPDATE SET
      last_seen_at=NOW(),
      last_success_at=CASE WHEN $1::boolean THEN NOW() ELSE worker_health.last_success_at END,
      last_failure_at=CASE WHEN $1::boolean THEN worker_health.last_failure_at ELSE NOW() END`,
    [succeeded]);
}
