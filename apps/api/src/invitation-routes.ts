import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {
  createTenantInvitation,revokeTenantInvitation,listTenantInvitations,
  acceptTenantInvitationExisting,acceptTenantInvitationNew,
} from '../../../packages/core/src/identity/invitations.ts';

const uuid=z.string().uuid();
const email=z.string().email().max(200).transform(x=>x.toLowerCase());
const code=z.string().regex(/^[0-9a-fA-F]{64}$/);
export function registerInvitationRoutes(
  app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>,
  issueSession:(reply:{setCookie:Function},userId:string)=>Promise<void>,
):void {
  app.get('/tenants/:tenantId/invitations',async req=>{
    const tenantId=uuid.parse((req.params as {tenantId:string}).tenantId);
    return listTenantInvitations(tenantId,await authenticated(req));
  });
  app.post('/tenants/:tenantId/invitations',async(req,reply)=>{
    const tenantId=uuid.parse((req.params as {tenantId:string}).tenantId);
    const actorId=await authenticated(req);
    const input=z.object({email,idempotencyKey:uuid}).strict().parse(req.body);
    const issued=await createTenantInvitation({
      tenantId,actorId,email:input.email,idempotencyKey:input.idempotencyKey,
    });
    return reply.code(201).send(issued);
  });
  app.post('/tenants/:tenantId/invitations/:inviteId/revoke',async req=>{
    const p=req.params as {tenantId:string;inviteId:string};
    const tenantId=uuid.parse(p.tenantId),invitationId=uuid.parse(p.inviteId);
    const actorId=await authenticated(req);
    const input=z.object({idempotencyKey:uuid}).strict().parse(req.body);
    return revokeTenantInvitation({
      tenantId,actorId,invitationId,idempotencyKey:input.idempotencyKey,
    });
  });
  app.post('/auth/invitations/claim',{config:{
    rateLimit:{max:5,timeWindow:'1 minute'},
  }},async(req,reply)=>{
    const input=z.object({
      code,email,displayName:z.string().trim().min(1).max(80),
      password:z.string().min(10).max(128),
    }).strict().parse(req.body);
    const userId=await acceptTenantInvitationNew({
      token:input.code,email:input.email,displayName:input.displayName,
      password:input.password,
    });
    await issueSession(reply,userId);
    return reply.code(201).send({ok:true});
  });
  app.post('/auth/invitations/claim-existing',async req=>{
    const userId=await authenticated(req);
    const input=z.object({code}).strict().parse(req.body);
    const result=await acceptTenantInvitationExisting({token:input.code,userId});
    return {ok:true,...result};
  });
}
