import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {listProjectReports,requestProjectReport,publishProjectReport} from
  '../../../packages/core/src/reporting/report-services.ts';

const uuid=z.string().uuid();
const generateSchema=z.object({
  idempotencyKey:uuid,kind:z.enum(['week','month']),
});
const publishSchema=z.object({
  idempotencyKey:uuid,expectedRevision:z.number().int().positive(),
});

/** Reporting HTTP is a thin identity/DTO adapter. All authorization,
 * transactions, report snapshots and formal mutations belong to Core.
 */
export function registerReportRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  app.get('/projects/:id/reports',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    return listProjectReports(projectId,await authenticated(req));
  });
  app.post('/projects/:id/reports',async req=>{
    const projectId=uuid.parse((req.params as {id:string}).id);
    const actorId=await authenticated(req);
    return requestProjectReport(projectId,actorId,generateSchema.parse(req.body));
  });
  app.post('/projects/:id/reports/:reportId/publish',async req=>{
    const p=req.params as {id:string;reportId:string};
    const projectId=uuid.parse(p.id),reportId=uuid.parse(p.reportId);
    const actorId=await authenticated(req);
    return publishProjectReport(projectId,reportId,actorId,publishSchema.parse(req.body));
  });
}
