import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {listProjectMembers,addProjectMember,changeProjectMemberRole,
  removeProjectMember,transferProjectOwnership,updateProjectSettings} from
  '../../../packages/core/src/identity/project-governance.ts';

const uuid=z.string().uuid();
const commandKey=z.object({idempotencyKey:uuid});
const invitation=commandKey.extend({
  email:z.string().email().transform(value=>value.toLowerCase()),
});
const roleUpdate=commandKey.extend({
  role:z.enum(['manager','member','observer']),
});
const transferInput=commandKey.extend({
  expectedRevision:z.number().int().positive(),
  targetUserId:uuid,
});
const settingsInput=commandKey.extend({
  expectedRevision:z.number().int().positive(),
  aiEnabled:z.boolean(),
  workStart:z.number().int().min(0).max(23).nullable(),
  workEnd:z.number().int().min(1).max(24).nullable(),
  cooldownHours:z.number().int().min(1).max(168).nullable(),
});

/** Human project owner commands, with current tenant and project membership
 * revalidated, audited and serialized in the same transaction as each write.
 */
export function registerProjectGovernanceRoutes(
  app:FastifyInstance,authenticated:(req:FastifyRequest)=>Promise<string>,
):void{
  app.get('/projects/:id/members',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    return listProjectMembers(projectId,await authenticated(req));
  });
  app.post('/projects/:id/members',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actor=await authenticated(req);
    const input=invitation.parse(req.body);
    return addProjectMember(projectId,actor,input);
  });
  app.patch('/projects/:id/members/:memberId',async req=>{
    const {id,memberId}=req.params as {id:string;memberId:string};
    const projectId=uuid.parse(id),target=uuid.parse(memberId);
    const actor=await authenticated(req);
    const input=roleUpdate.parse(req.body);
    return changeProjectMemberRole(projectId,target,actor,input);
  });
  app.delete('/projects/:id/members/:memberId',async req=>{
    const {id,memberId}=req.params as {id:string;memberId:string};
    const projectId=uuid.parse(id),target=uuid.parse(memberId);
    const actor=await authenticated(req);
    const input=commandKey.parse(req.body);
    return removeProjectMember(projectId,target,actor,input);
  });
  app.post('/projects/:id/ownership-transfer',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actor=await authenticated(req);
    const input=transferInput.parse(req.body);
    return transferProjectOwnership(projectId,actor,input);
  });
  app.patch('/projects/:id/settings',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actor=await authenticated(req);
    const input=settingsInput.parse(req.body);
    return updateProjectSettings(projectId,actor,input);
  });
}
