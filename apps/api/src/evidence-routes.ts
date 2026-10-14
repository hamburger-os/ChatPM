import type { FastifyInstance,FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  createEvidenceClaim,listEvidenceClaims,reviewEvidenceClaim,
} from '../../../packages/core/src/evidence/claim-commands.ts';

const uuid=z.string().uuid();
const categories=z.enum([
  'work_progress','completion_claim','commitment','blocker','risk_signal',
  'issue_signal','decision_signal','change_signal','observation',
]);
const createSchema=z.object({
  idempotencyKey:uuid,messageId:uuid,
  startCp:z.number().int().min(0).max(9999),
  endCp:z.number().int().positive().max(10000),
  kind:categories,summary:z.string().trim().min(1).max(2000),
}).refine(v=>v.endCp>v.startCp&&v.endCp-v.startCp<=2000,{
  message:'证据片段不能超出消息内容且最多 2000 个字符',
});
const reviewSchema=z.object({
  idempotencyKey:uuid,expectedVersion:z.number().int().positive(),
  decision:z.enum(['acknowledge','dismiss']),
});
const paging=z.object({
  beforeAt:z.string().datetime({offset:true}).optional(),
  beforeId:uuid.optional(),
}).refine(v=>(v.beforeAt===undefined)===(v.beforeId===undefined),{
  message:'分页游标必须包含时间和 ID',
});

export function registerEvidenceRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  app.get('/projects/:projectId/evidence/claims',async req=>{
    const projectId=uuid.parse((req.params as {projectId:string}).projectId);
    const actorId=await authenticated(req);
    const q=paging.parse(req.query);
    return listEvidenceClaims({projectId,actorId,beforeAt:q.beforeAt,beforeId:q.beforeId});
  });

  app.post('/projects/:projectId/evidence/claims',async(req,reply)=>{
    const projectId=uuid.parse((req.params as {projectId:string}).projectId);
    const actorId=await authenticated(req);
    const input=createSchema.parse(req.body);
    const result=await createEvidenceClaim({projectId,actorId,...input});
    return reply.code(201).send(result);
  });

  app.post('/projects/:projectId/evidence/claims/:claimId/review',async req=>{
    const p=req.params as {projectId:string;claimId:string};
    const projectId=uuid.parse(p.projectId),claimId=uuid.parse(p.claimId);
    const actorId=await authenticated(req);
    const input=reviewSchema.parse(req.body);
    return reviewEvidenceClaim({projectId,claimId,actorId,...input});
  });
}
