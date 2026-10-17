import {pool} from '../db.ts';

export type WorkerLane='events'|'reminders'|'reports';

/** One authoritative operational signal per Worker lane, not a shared
 * last-success row. Independent reminder successes can never hide an
 * event-lane outage. This is telemetry, never a PM domain event.
 */
export async function recordWorkerHeartbeat(
  lane:WorkerLane,succeeded:boolean,
):Promise<void>{
  await pool.query(`
    INSERT INTO worker_health(name,last_seen_at,last_success_at,last_failure_at)
    VALUES($1,NOW(),CASE WHEN $2::boolean THEN NOW() ELSE NULL END,
      CASE WHEN $2::boolean THEN NULL ELSE NOW() END)
    ON CONFLICT(name) DO UPDATE SET
      last_seen_at=NOW(),
      last_success_at=CASE WHEN $2::boolean THEN NOW()
        ELSE worker_health.last_success_at END,
      last_failure_at=CASE WHEN $2::boolean THEN worker_health.last_failure_at
        ELSE NOW() END
  `,[lane,succeeded]);
}
