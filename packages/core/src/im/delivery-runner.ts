import {transaction,pool} from '../db.ts';
import type {OutboundText} from '../../../im/src/contracts.ts';

/** A channel-specific message must be persisted *before* its network call. */
export type SendExternal=(accountId:string,message:OutboundText)=>Promise<unknown>;
type Claimed={
  id:string;account_id:string;external_bot_id:string;
  external_chat_id:string;content:string;
};
export async function processImDeliveries(send:SendExternal):Promise<void>{
  const batch=await transaction(async db=>{
    // A prior worker may have crashed after sending. Do not retry blindly.
    await db.query(`UPDATE im_deliveries SET state='unknown',settled_at=now()
      WHERE state='sending' AND started_at<now()-interval '5 minutes'`);
    await db.query(`UPDATE im_deliveries d SET state='cancelled',settled_at=now()
      WHERE state='pending' AND NOT EXISTS(
        SELECT 1 FROM im_room_bindings r JOIN im_accounts a ON a.id=r.account_id
        WHERE r.account_id=d.account_id AND r.project_id=d.project_id
        AND r.external_chat_id=d.external_chat_id AND r.active AND a.enabled
      )`);
    const r=await db.query<Claimed>(`
      WITH selected AS (
        SELECT d.id FROM im_deliveries d
        JOIN im_room_bindings room
          ON room.account_id=d.account_id AND room.project_id=d.project_id
          AND room.external_chat_id=d.external_chat_id AND room.active
        JOIN im_accounts a ON a.id=d.account_id AND a.enabled
        WHERE d.state='pending'
        ORDER BY d.created_at LIMIT 10 FOR UPDATE OF d SKIP LOCKED
      ), claims AS (
        UPDATE im_deliveries d SET state='sending',started_at=now()
        FROM selected WHERE d.id=selected.id
        RETURNING d.id,d.account_id,d.external_chat_id,d.message_id
      )
      SELECT c.id,c.account_id,c.external_chat_id,a.external_bot_id,m.content
      FROM claims c JOIN im_accounts a ON a.id=c.account_id
      JOIN messages m ON m.id=c.message_id`);
    return r.rows;
  });
  for(const item of batch){
    let state:'accepted'|'pending'|'unknown'|'failed'='accepted';
    try{
      await send(item.account_id,{accountId:item.external_bot_id,
        route:{kind:'group',externalConversationId:item.external_chat_id},
        text:item.content});
    }catch(error){
      const code=(error as {code?:unknown}).code;
      state=code==='BOT_NOT_CONNECTED'?'pending'
        :error instanceof TypeError?'failed':'unknown';
    }
    await pool.query(`UPDATE im_deliveries SET state=$2,
      settled_at=CASE WHEN $2='pending' THEN NULL ELSE now() END,
      started_at=CASE WHEN $2='pending' THEN NULL ELSE started_at END
      WHERE id=$1 AND state='sending'`,[item.id,state]);
  }
}
