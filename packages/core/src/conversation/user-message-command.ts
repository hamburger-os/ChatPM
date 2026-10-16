import { audit, transaction } from '../db.ts';
import { lockProjectAccess } from '../identity/project-access.ts';
import { assertProject } from '../permissions.ts';
import { insertMessage } from '../messages.ts';

function conflict():never {
  throw Object.assign(new Error('消息幂等键冲突'),{statusCode:409});
}

/**
 * Only this command may accept a user-authored message from an HTTP client.
 * Tenant/project membership and the message.write grant are locked in the
 * SAME transaction as Message, Outbox and Audit. A concurrent revocation
 * therefore cannot commit in between authorization and publication.
 */
export async function postUserMessage(
  projectId:string,actorId:string,content:string,nonce:string,
){
  return transaction(async db=>{
    const access=await lockProjectAccess(db,projectId,actorId);
    assertProject(access.role,'message.write');
    let message=await insertMessage(db,{
      projectId,authorId:actorId,kind:'user',content,nonce,
    });
    if(!message){
      const previous=await db.query<{
        id:string;author_id:string|null;content:string;
      }>('SELECT * FROM messages WHERE project_id=$1 AND client_nonce=$2',
        [projectId,nonce]);
      message=previous.rows[0] as typeof message;
      if(!message||message.author_id!==actorId||message.content!==content)
        conflict();
    }else{
      await db.query(
        "INSERT INTO outbox_events(project_id,kind,message_id) VALUES($1,'message.created',$2)",
        [projectId,message.id]);
      await audit(db,projectId,actorId,'message.created',message.id);
    }
    return {message};
  });
}
