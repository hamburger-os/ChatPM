import { pool, transaction, type DbClient } from './db.ts';
import { DailyAIBudgetExceeded } from './ai-provider.ts';

export const MAX_EVENT_ATTEMPTS=8;
export type EventRow={
  id:string; project_id:string; kind:string; message_id:string|null;
  claimed_at:Date; claim_token:string; attempts:number;
};

export async function claimEvents(limit=12):Promise<EventRow[]>{
  return transaction(async db=>{
    // Crashed final-attempt consumers are eventually quarantined too.
    await db.query(`UPDATE outbox_events
      SET dead_at=NOW(),last_error_code=COALESCE(last_error_code,'LEASE_EXPIRED'),
          claimed_at=NULL,claim_token=NULL
      WHERE processed_at IS NULL AND dead_at IS NULL AND attempts >= $1
        AND claimed_at < NOW()-INTERVAL '5 minutes'`,[MAX_EVENT_ATTEMPTS]);
    const {rows}=await db.query(`SELECT id,project_id,kind,message_id FROM outbox_events
      WHERE processed_at IS NULL AND dead_at IS NULL AND attempts < $1
        AND next_attempt_at<=NOW()
        AND (claimed_at IS NULL OR claimed_at < NOW()-INTERVAL '5 minutes')
      ORDER BY next_attempt_at,created_at LIMIT $2 FOR UPDATE SKIP LOCKED`,
      [MAX_EVENT_ATTEMPTS,limit]);
    if(!rows.length)return [];
    const claimed=await db.query(`UPDATE outbox_events SET claimed_at=NOW(),claim_token=gen_random_uuid(),attempts=attempts+1
      WHERE id=ANY($1::uuid[]) RETURNING id,project_id,kind,message_id,claimed_at,claim_token,attempts`,
      [rows.map((r:{id:string})=>r.id)]);
    return claimed.rows as EventRow[];
  });
}

export const OUTBOX_LEASE_MINUTES=5;

/**
 * Publication fence: hold the live claim row FOR UPDATE until the same
 * transaction commits its AI reply/candidate/clarification. Another worker's
 * SKIP LOCKED reclaim cannot replace this token while effects are committed.
 * An expired (even not yet reclaimed) or completed lease is never authority.
 */
export async function assertEventClaim(db:DbClient,event:EventRow):Promise<void>{
  const {rowCount}=await db.query(`
    SELECT 1 FROM outbox_events
    WHERE id=$1 AND project_id=$2 AND claim_token=$3
      AND claimed_at>NOW()-INTERVAL '5 minutes'
      AND processed_at IS NULL AND dead_at IS NULL
    FOR UPDATE
  `,[event.id,event.project_id,event.claim_token]);
  if(!rowCount)throw new Error('OUTBOX_LEASE_LOST');
}

export async function finishEvent(event:EventRow){
  await pool.query(`UPDATE outbox_events SET processed_at=NOW(),claimed_at=NULL,claim_token=NULL,last_error_code=NULL
    WHERE id=$1 AND claim_token=$2 AND processed_at IS NULL AND dead_at IS NULL`,
    [event.id,event.claim_token]);
}

export function failureCode(error:unknown){
  if(error instanceof Error){
    if(/^MODEL_HTTP_\d{3}$/.test(error.message))return error.message;
    if(/^MODEL_(INCOMPLETE_OUTPUT|EMPTY_OUTPUT|INVALID_JSON)$/.test(error.message))return error.message;
    if(error.message==='MODEL_NOT_CONFIGURED')return 'MODEL_NOT_CONFIGURED';
    const m=/^Model request failed: HTTP (\d{3})$/.exec(error.message);
    if(m)return 'MODEL_HTTP_'+m[1];
    if(error.name==='AbortError')return 'MODEL_TIMEOUT';
    if(error.name==='ZodError')return 'MODEL_SCHEMA';
  }
  return 'PROCESSING_ERROR';
}

export async function failEvent(event:EventRow,error:unknown){
  if(error instanceof DailyAIBudgetExceeded){
    await pool.query(`UPDATE outbox_events SET claimed_at=NULL,claim_token=NULL,
      last_error_code='AI_DAILY_BUDGET',attempts=GREATEST(0,attempts-1),
      next_attempt_at=date_trunc('day',NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        +INTERVAL '1 day 5 minutes'
      WHERE id=$1 AND claim_token=$2 AND processed_at IS NULL AND dead_at IS NULL`,
      [event.id,event.claim_token]);
    return;
  }
  const code=failureCode(error);
  // A deterministic model schema failure cannot be fixed by retrying 8 times unchanged.
  if(code==='MODEL_SCHEMA'){
    await pool.query(`UPDATE outbox_events SET claimed_at=NULL,claim_token=NULL,
      last_error_code='MODEL_SCHEMA',dead_at=NOW(),next_attempt_at=NOW()
      WHERE id=$1 AND claim_token=$2 AND processed_at IS NULL AND dead_at IS NULL`,
      [event.id,event.claim_token]);
    return;
  }
  // Error class only: no chat, model output, credentials or stack in persisted state.
  await pool.query(`UPDATE outbox_events
    SET claimed_at=NULL,claim_token=NULL,
      last_error_code=$3,
      dead_at=CASE WHEN attempts >= $4 THEN NOW() ELSE NULL END,
      next_attempt_at=NOW()+(
        LEAST(3600,5*POWER(2,LEAST(attempts,10))) * INTERVAL '1 second')
    WHERE id=$1 AND claim_token=$2 AND processed_at IS NULL AND dead_at IS NULL`,
    [event.id,event.claim_token,failureCode(error),MAX_EVENT_ATTEMPTS]);
}

export async function deadEvents(projectId:string){
  return (await pool.query(`SELECT id,kind,message_id,attempts,last_error_code,dead_at
    FROM outbox_events WHERE project_id=$1 AND dead_at IS NOT NULL AND processed_at IS NULL
    ORDER BY dead_at DESC LIMIT 100`,[projectId])).rows;
}

export async function outboxSummary(projectId:string){
  const {rows}=await pool.query(`SELECT
    COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_at IS NULL)::int AS pending,
    COUNT(*) FILTER (WHERE processed_at IS NULL AND dead_at IS NOT NULL)::int AS dead,
    COUNT(*) FILTER (WHERE last_error_code LIKE 'MODEL_%')::int AS model_errors,
    MIN(created_at) FILTER (WHERE processed_at IS NULL AND dead_at IS NULL) AS oldest_pending_at
    FROM outbox_events WHERE project_id=$1`,[projectId]);
  return rows[0] as {pending:number;dead:number;model_errors:number;oldest_pending_at:Date|null};
}
