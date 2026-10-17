import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {listMemberProjects} from '../../../packages/core/src/project-queries.ts';
import {createProjectCommand} from '../../../packages/core/src/project-creation.ts';

const uuid=z.string().uuid();
const createInput=z.object({
  idempotencyKey:uuid,
  name:z.string().trim().min(1).max(140),
  tenantId:uuid,
  timezone:z.string().default('Asia/Shanghai'),
});

/** Project bootstrap uses a tenant-scoped receipt: a project-scoped receipt
 * alone cannot deduplicate a request before its first project ID exists.
 */
export function registerProjectRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  app.get('/projects',async req=>{
    return listMemberProjects(await authenticated(req));
  });
  app.post('/projects',async(req,reply)=>{
    const actorId=await authenticated(req);
    const input=createInput.parse(req.body);
    const result=await createProjectCommand(actorId,input);
    return reply.code(201).send(result);
  });
}
