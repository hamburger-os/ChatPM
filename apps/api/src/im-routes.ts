import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {
  registerWecomBot,listWecomBots,listVisibleWecomBots,disableWecomBot,beginWecomUserBinding,
  beginWecomRoomBinding,revokeWecomRoomBinding,
} from '../../../packages/core/src/im/wecom-service.ts';

const uuid=z.string().uuid();
/** All endpoints require the real HTTP session. No IM-provided identity in any DTO. */
export function registerImRoutes(
  app:FastifyInstance,authenticated:(req:FastifyRequest)=>Promise<string>,
):void{
  app.get('/im/bots',async req=>listVisibleWecomBots(await authenticated(req)));
  app.get('/tenants/:tenantId/im/bots',async req=>{
    const actor=await authenticated(req);
    const tenantId=uuid.parse((req.params as {tenantId:string}).tenantId);
    return listWecomBots(tenantId,actor);
  });
  app.post('/tenants/:tenantId/im/bots',async req=>{
    const actor=await authenticated(req);
    const tenantId=uuid.parse((req.params as {tenantId:string}).tenantId);
    return registerWecomBot(tenantId,actor,req.body);
  });
  app.post('/tenants/:tenantId/im/bots/:accountId/disable',async req=>{
    const actor=await authenticated(req);
    const {tenantId,accountId}=req.params as {tenantId:string,accountId:string};
    const {idempotencyKey}=z.object({idempotencyKey:uuid}).strict().parse(req.body);
    return disableWecomBot(uuid.parse(tenantId),actor,uuid.parse(accountId),idempotencyKey);
  });
  app.post('/im/bots/:accountId/bind-me',async req=>{
    const actor=await authenticated(req);
    return beginWecomUserBinding(uuid.parse((req.params as {accountId:string}).accountId),actor);
  });
  app.post('/projects/:projectId/im/bots/:accountId/link',async req=>{
    const actor=await authenticated(req);
    const {projectId,accountId}=req.params as {projectId:string,accountId:string};
    return beginWecomRoomBinding(uuid.parse(projectId),uuid.parse(accountId),actor);
  });
  app.delete('/projects/:projectId/im/bots/:accountId/link',async req=>{
    const actor=await authenticated(req);
    const {projectId,accountId}=req.params as {projectId:string,accountId:string};
    return revokeWecomRoomBinding(uuid.parse(projectId),uuid.parse(accountId),actor);
  });
}
