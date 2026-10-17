import {transaction} from '../db.ts';
import {lockProjectAccess} from '../identity/project-access.ts';

export type MessagePageCursor={after?:number;before?:number;limit?:number};
export type ProjectMessage={
  id:string;seq:string;kind:'user'|'ai';content:string;
  client_nonce:string;created_at:Date;author_id:string|null;
  author:string|null;
};

const fields=`m.id,m.seq,m.kind,m.content,m.client_nonce,
  m.created_at,m.author_id,u.display_name AS author`;

/** Message seq is globally unique and allocated under a per-project commit
 * lock; we paginate by seq rather than timestamp or an ephemeral SSE offset.
 * The same DB transaction locks current tenant + project membership before
 * any content is read (including historical pages and live stream batches).
 */
export async function listProjectMessages(
  projectId:string,actorId:string,cursor:MessagePageCursor={},
){
  const limit=cursor.limit??200;
  if(!Number.isInteger(limit)||limit<1||limit>200 ||
    (cursor.after!==undefined&&cursor.before!==undefined&&cursor.after!==0))
    throw Object.assign(new Error('消息游标不合法'),{statusCode:400});
  for(const seq of [cursor.after,cursor.before]){
    if(seq!==undefined&&(!Number.isSafeInteger(seq)||seq<0))
      throw Object.assign(new Error('消息游标不合法'),{statusCode:400});
  }
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await lockProjectAccess(db,projectId,actorId);
    const recent=cursor.before===undefined&&(cursor.after??0)===0;
    const backwards=recent||cursor.before!==undefined;
    const key=cursor.before??cursor.after??0;
    const where=recent?'':cursor.before!==undefined?'AND m.seq<$2':'AND m.seq>$2';
    const args=recent?[projectId,limit+1]:[projectId,key,limit+1];
    const {rows}=await db.query<ProjectMessage>(`
      SELECT ${fields} FROM messages m
      LEFT JOIN users u ON u.id=m.author_id
      WHERE m.project_id=$1 ${where}
      ORDER BY m.seq ${backwards?'DESC':'ASC'}
      LIMIT $${recent?2:3}`,args);
    const hasMore=rows.length>limit;
    const selected=rows.slice(0,limit);
    if(backwards)selected.reverse();
    return {
      messages:selected,
      hasMore,
      oldestCursor:selected.length?selected[0].seq:null,
      newestCursor:selected.length?selected[selected.length-1].seq:null,
    };
  });
}
