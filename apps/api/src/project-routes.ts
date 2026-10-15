import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {pool} from '../../../packages/core/src/db.ts';
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
    const userId=await authenticated(req);
    const {rows}=await pool.query(`
      SELECT p.id,p.name,p.timezone,p.ai_enabled,p.work_start,p.work_end,
        p.cooldown_hours,p.settings_revision,p.owner_id,p.ownership_revision,pm.role
      FROM projects p JOIN project_members pm ON pm.project_id=p.id
      JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
      WHERE pm.user_id=$1 ORDER BY p.created_at DESC
    `,[userId]);
    return {projects:rows};
  });
  app.post('/projects',async(req,reply)=>{
    const actorId=await authenticated(req);
    const input=createInput.parse(req.body);
    const result=await createProjectCommand(actorId,input);
    return reply.code(201).send(result);
  });
}
