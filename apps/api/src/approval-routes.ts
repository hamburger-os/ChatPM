import type { FastifyInstance,FastifyRequest } from 'fastify';
import { z } from 'zod';
import { executePmCommand } from '../../../packages/core/src/pm-command.ts';
import { ensureTaskAssignee } from '../../../packages/core/src/delivery/task-assignee.ts';
import { syncFollowup } from '../../../packages/core/src/followup.ts';

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
function fail(statusCode:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode});
}

/** Decisions are issued by an authorized person, never directly by an AI model. */
export function registerApprovalRoutes(app:FastifyInstance,
  authenticated:(req:FastifyRequest)=>Promise<string>):void{
  app.post('/projects/:id/progress/:progressId/decision',async req=>{
    const p=req.params as {id:string;progressId:string};
    const projectId=uuid.parse(p.id),progressId=uuid.parse(p.progressId);
    const actorId=await authenticated(req);
    const v=reviewSchema.parse(req.body);
    return executePmCommand({
      projectId,actorId,action:'proposal.approve',
      kind:'task.progress.reviewed.v1',idempotencyKey:v.idempotencyKey,
      payload:{progressId,...v},
      mutate:async db=>{
        // Atomic single-shot decision, scoped by project and pending status.
        const {rows}=await db.query<{task_id:string;kind:string}>(`
          UPDATE task_progress_updates SET
            status=$3,reviewed_by=$4,reviewed_at=NOW()
          WHERE project_id=$1 AND id=$2 AND status='pending'
          RETURNING task_id,kind
        `,[projectId,progressId,v.decision,actorId]);
        const evidence=rows[0];
        if(!evidence)fail(409,'进度建议已处理或不存在');
        if(v.decision==='accepted'&&evidence.kind==='blocker'){
          // Keep the last-send cooldown even when a newly accepted blocker
          // requests an early recheck.
          await db.query(`UPDATE followup_plans fp SET next_at=GREATEST(
            LEAST(fp.next_at,NOW()+INTERVAL '1 minute'),
            COALESCE(fp.last_sent_at+(p.cooldown_hours*INTERVAL '1 hour'),NOW()))
            FROM projects p
            WHERE p.id=$1 AND fp.project_id=p.id
              AND fp.task_id=$2 AND fp.active`,
            [projectId,evidence.task_id]);
        }
        return {response:{ok:true},
          aggregateType:'task_progress_updates',aggregateId:progressId,
          aggregateVersion:1,
          auditDetails:{decision:v.decision,taskId:evidence.task_id,kind:evidence.kind}};
      },
    });
  });
  app.post('/projects/:id/proposals/:proposalId/decision',async req=>{
    const p=req.params as {id:string;proposalId:string};
    const projectId=uuid.parse(p.id),proposalId=uuid.parse(p.proposalId);
    const actorId=await authenticated(req);
    const v=proposalReviewSchema.parse(req.body);
    return executePmCommand({
      projectId,actorId,action:'proposal.approve',
      kind:'proposal.reviewed.v1',idempotencyKey:v.idempotencyKey,
      payload:{proposalId,...v},
      mutate:async db=>{
        const lookup=await db.query<{
          id:string;status:string;kind:'task'|'risk';title:string;detail:string;
          due_at:Date|null;clarified_due_at:Date|null;
        }>(`
          SELECT pc.id,pc.status,pc.kind,pc.title,pc.detail,pc.due_at,
            ct.due_at AS clarified_due_at
          FROM proposed_changes pc
          LEFT JOIN clarification_threads ct ON ct.proposal_id=pc.id
          WHERE pc.project_id=$1 AND pc.id=$2 FOR UPDATE OF pc
        `,[projectId,proposalId]);
        const proposal=lookup.rows[0];
        if(!proposal)fail(404,'待确认事项不存在');
        if(proposal.status!=='pending')fail(409,'该事项已经处理');
        let createdTaskId:string|null=null,createdRiskId:string|null=null;
        if(v.decision==='accepted'){
          if(proposal.kind==='task'){
            if(v.assigneeId)await ensureTaskAssignee(db,projectId,v.assigneeId);
            const {rows}=await db.query<{id:string}>(`
              INSERT INTO tasks(project_id,title,detail,assignee_id,due_date,source_proposal_id)
              VALUES($1,$2,$3,$4,
                CASE WHEN $5::boolean THEN $6::date
                ELSE (COALESCE($7::timestamptz,$8::timestamptz)
                  AT TIME ZONE (SELECT timezone FROM projects WHERE id=$1))::date END,
                $9) RETURNING id
            `,[projectId,proposal.title,proposal.detail,v.assigneeId,
              v.dueDate!==undefined,v.dueDate??null,
              proposal.clarified_due_at,proposal.due_at,proposal.id]);
            createdTaskId=rows[0].id;
            await syncFollowup(db,projectId,createdTaskId);
          }else{
            const {rows}=await db.query<{id:string}>(`
              INSERT INTO risks(project_id,title,detail,source_proposal_id)
              VALUES($1,$2,$3,$4) RETURNING id
            `,[projectId,proposal.title,proposal.detail,proposal.id]);
            createdRiskId=rows[0].id;
          }
        }
        await db.query(`
          UPDATE proposed_changes SET status=$3,approved_by=$4
          WHERE project_id=$1 AND id=$2
        `,[projectId,proposalId,v.decision,actorId]);
        await db.query(`
          UPDATE clarification_threads SET status='closed',updated_at=NOW()
          WHERE project_id=$1 AND proposal_id=$2
        `,[projectId,proposalId]);
        return {response:{ok:true},aggregateType:'proposed_changes',
          aggregateId:proposalId,aggregateVersion:1,
          auditDetails:{decision:v.decision,proposalKind:proposal.kind,
            createdTaskId,createdRiskId}};
      },
    });
  });
}
