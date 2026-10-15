import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {pool} from '../../../packages/core/src/db.ts';
import {assertProject,type ProjectRole} from '../../../packages/core/src/permissions.ts';
import {deadEvents,outboxSummary} from '../../../packages/core/src/outbox.ts';
import {executePmCommand} from '../../../packages/core/src/pm-command.ts';

const uuid=z.string().uuid();
const body=z.object({idempotencyKey:uuid});
function fail(code:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode:code});
}
async function ownerForRead(projectId:string,actorId:string):Promise<void>{
  const {rows}=await pool.query<{role:ProjectRole}>(`
    SELECT pm.role FROM projects p
    JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
    JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=$2
    WHERE p.id=$1
  `,[projectId,actorId]);
  if(!rows[0])fail(404,'项目不存在或无权限');
  assertProject(rows[0].role,'operations.manage');
}

/** Operational read models and the one authorized dead-letter recovery command.
 * A replayed HTTP request never resets a healthy Worker lease.
 */
export function registerOperationsRoutes(
  app:FastifyInstance,authenticated:(req:FastifyRequest)=>Promise<string>,
):void{
  app.get('/projects/:id/outbox/summary',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actorId=await authenticated(req);
    await ownerForRead(projectId,actorId);
    return {summary:await outboxSummary(projectId)};
  });
  app.get('/projects/:id/outbox/dead',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actorId=await authenticated(req);
    await ownerForRead(projectId,actorId);
    return {events:await deadEvents(projectId)};
  });
  app.post('/projects/:id/outbox/:eventId/retry',async req=>{
    const p=req.params as {id:string;eventId:string};
    const projectId=uuid.parse(p.id),eventId=uuid.parse(p.eventId);
    const actorId=await authenticated(req);
    const input=body.parse(req.body);
    return executePmCommand({
      projectId,actorId,action:'operations.manage',
      kind:'outbox.dead_letter_retried.v1',
      idempotencyKey:input.idempotencyKey,payload:{eventId,...input},
      mutate:async db=>{
        const previous=(await db.query<{attempts:number}>(`
          SELECT attempts FROM outbox_events
          WHERE project_id=$1 AND id=$2
            AND dead_at IS NOT NULL AND processed_at IS NULL FOR UPDATE
        `,[projectId,eventId])).rows[0];
        if(!previous)fail(409,'事件未隔离或不属于当前项目');
        const restored=await db.query<{id:string}>(`
          UPDATE outbox_events
          SET attempts=0,dead_at=NULL,last_error_code=NULL,
            claimed_at=NULL,claim_token=NULL,next_attempt_at=NOW()
          WHERE project_id=$1 AND id=$2
            AND dead_at IS NOT NULL AND processed_at IS NULL RETURNING id
        `,[projectId,eventId]);
        if(!restored.rowCount)fail(409,'该事件已被恢复或处理');
        return {response:{ok:true},aggregateType:'outbox_events',
          aggregateId:eventId,aggregateVersion:1,
          auditDetails:{previousAttempts:previous.attempts}};
      },
    });
  });
}
