import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {readOutboxSummary,readDeadEvents,retryDeadEvent} from
  '../../../packages/core/src/operations/outbox-admin.ts';

const uuid=z.string().uuid();
const body=z.object({idempotencyKey:uuid});

/** HTTP only validates caller and DTO; operations state belongs to Core. */
export function registerOperationsRoutes(
  app:FastifyInstance,authenticated:(req:FastifyRequest)=>Promise<string>,
):void{
  app.get('/projects/:id/outbox/summary',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actorId=await authenticated(req);
    return readOutboxSummary(projectId,actorId);
  });
  app.get('/projects/:id/outbox/dead',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actorId=await authenticated(req);
    return readDeadEvents(projectId,actorId);
  });
  app.post('/projects/:id/outbox/:eventId/retry',async req=>{
    const p=req.params as {id:string;eventId:string};
    const projectId=uuid.parse(p.id),eventId=uuid.parse(p.eventId);
    const actorId=await authenticated(req);
    return retryDeadEvent(projectId,eventId,actorId,body.parse(req.body));
  });
}
