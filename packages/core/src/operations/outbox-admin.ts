import {transaction,type DbClient} from '../db.ts';
import {lockProjectAccess} from '../identity/project-access.ts';
import {assertProject} from '../permissions.ts';
import {deadEvents,outboxSummary} from '../outbox.ts';
import {executePmCommand} from '../pm-command.ts';

function fail(code:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode:code});
}

/** All operations diagnostics share one authorization lock and one MVCC
 * snapshot. A removed tenant/project member cannot read subsequent events
 * through a stale preflight authorization on another DB connection.
 */
async function readOperations<T>(projectId:string,actorId:string,
  read:(db:DbClient)=>Promise<T>):Promise<T>{
  return transaction(async db=>{
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const access=await lockProjectAccess(db,projectId,actorId);
    assertProject(access.role,'operations.manage');
    return read(db);
  });
}

export function readOutboxSummary(projectId:string,actorId:string){
  return readOperations(projectId,actorId,async db=>({
    summary:await outboxSummary(projectId,db),
  }));
}

export function readDeadEvents(projectId:string,actorId:string){
  return readOperations(projectId,actorId,async db=>({
    events:await deadEvents(projectId,db),
  }));
}

/** Replaying a quarantined delivery never touches a healthy claim.
 * The same command receipt, domain event, audit and outbox are committed
 * within the existing project command transaction.
 */
export function retryDeadEvent(
  projectId:string,eventId:string,actorId:string,v:{idempotencyKey:string},
){
  return executePmCommand({
    projectId,actorId,action:'operations.manage',
    kind:'outbox.dead_letter_retried.v1',
    idempotencyKey:v.idempotencyKey,payload:{eventId,...v},
    mutate:async db=>{
      const previous=(await db.query<{attempts:number}>(`
        SELECT attempts FROM outbox_events
        WHERE project_id=$1 AND id=$2
          AND dead_at IS NOT NULL AND processed_at IS NULL FOR UPDATE
      `,[projectId,eventId])).rows[0];
      if(!previous)fail(409,'事件未隔离或不属于当前项目');
      const restored=await db.query<{id:string;manual_retry_revision:number}>(`
        UPDATE outbox_events
        SET attempts=0,dead_at=NULL,last_error_code=NULL,
          claimed_at=NULL,claim_token=NULL,next_attempt_at=NOW(),
          manual_retry_revision=manual_retry_revision+1
        WHERE project_id=$1 AND id=$2
          AND dead_at IS NOT NULL AND processed_at IS NULL
        RETURNING id,manual_retry_revision
      `,[projectId,eventId]);
      if(!restored.rowCount)fail(409,'该事件已被恢复或处理');
      return {response:{ok:true,recoveryRevision:restored.rows[0].manual_retry_revision},
        aggregateType:'outbox_events',aggregateId:eventId,
        aggregateVersion:restored.rows[0].manual_retry_revision,
        auditDetails:{previousAttempts:previous.attempts}};
    },
  });
}
