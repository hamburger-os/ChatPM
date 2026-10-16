import type { FastifyInstance,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { decideProgress,decideProposal } from '../../../packages/core/src/approval/decision-commands.ts';

const uuid=z.string().uuid();
const dateOnly=z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(
  v=>!Number.isNaN(Date.parse(v+'T00:00:00Z')) &&
    new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v,'Invalid calendar date');
const reviewSchema=z.object({
  idempotencyKey:uuid,decision:z.enum(['accepted','rejected']),
});
const proposalReviewSchema=reviewSchema.extend({
  assigneeId:uuid.nullable().default(null),
  dueDate:dateOnly.nullable().optional(),
});
/** Decisions are issued by an authorized person, never directly by an AI model.
 * HTTP validates DTOs; Core is the only owner of review transactions.
 */
export function registerApprovalRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  app.post('/projects/:id/progress/:progressId/decision',async req=>{
    const p=req.params as {id:string;progressId:string};
    const projectId=uuid.parse(p.id),progressId=uuid.parse(p.progressId);
    const actorId=await authenticated(req);
    const v=reviewSchema.parse(req.body);
    return decideProgress(projectId,progressId,actorId,v);
  });
  app.post('/projects/:id/proposals/:proposalId/decision',async req=>{
    const p=req.params as {id:string;proposalId:string};
    const projectId=uuid.parse(p.id),proposalId=uuid.parse(p.proposalId);
    const actorId=await authenticated(req);
    const v=proposalReviewSchema.parse(req.body);
    return decideProposal(projectId,proposalId,actorId,v);
  });
}
