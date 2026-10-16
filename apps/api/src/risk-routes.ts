import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {listProjectRisks,readRiskHistory} from '../../../packages/core/src/risk/risk-queries.ts';
import {assessRisk,transitionRisk} from '../../../packages/core/src/risk/risk-commands.ts';

const uuid=z.string().uuid();
const version=z.object({
  idempotencyKey:uuid,expectedVersion:z.number().int().positive(),
});
const explanation=z.string().trim().min(1).max(2000);
const assessment=version.extend({
  likelihood:z.number().int().min(1).max(5),
  impact:z.number().int().min(1).max(5),
  ownerId:uuid,responsePlan:z.string().trim().min(1).max(5000),
  note:explanation,
});
const transition=version.extend({
  decision:z.enum(['start_mitigation','resolve','reopen']),
  note:explanation,
});
function context(req:FastifyRequest):{projectId:string;riskId:string}{
  const p=req.params as {id:string;riskId?:string};
  return {projectId:uuid.parse(p.id),riskId:p.riskId?uuid.parse(p.riskId):''};
}

/** HTTP validates DTOs and delegates; Core owns domain reads and writes. */
export function registerRiskRoutes(
  app:FastifyInstance,authenticated:(req:FastifyRequest)=>Promise<string>,
):void{
  app.get('/projects/:id/risks',async req=>{
    const {projectId}=context(req);
    return listProjectRisks(projectId,await authenticated(req));
  });
  app.patch('/projects/:id/risks/:riskId/assessment',async req=>{
    const {projectId,riskId}=context(req);
    const actorId=await authenticated(req);
    return assessRisk(projectId,riskId,actorId,assessment.parse(req.body));
  });
  app.post('/projects/:id/risks/:riskId/transition',async req=>{
    const {projectId,riskId}=context(req);
    const actorId=await authenticated(req);
    return transitionRisk(projectId,riskId,actorId,transition.parse(req.body));
  });
  app.get('/projects/:id/risks/:riskId/history',async req=>{
    const {projectId,riskId}=context(req);
    const actorId=await authenticated(req);
    const query=z.object({beforeVersion:z.coerce.number().int().positive().optional()})
      .parse(req.query);
    return readRiskHistory(projectId,riskId,actorId,query.beforeVersion);
  });
}
