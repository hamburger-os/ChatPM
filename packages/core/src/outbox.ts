import { pool, transaction } from './db.ts';
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

export async function finishEvent(event:EventRow){
  await pool.query(`UPDATE outbox_events SET processed_at=NOW(),claimed_at=NULL,claim_token=NULL,last_error_code=NULL
    WHERE id=$1 AND claim_token=$2 AND processed_at IS NULL AND dead_at IS NULL`,
    [event.id,event.claim_token]);
}

export function failureCode(error:unknown){
  if(error instanceof Error){
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
