import { executePmCommand } from '../pm-command.ts';
import { createTaskRecord } from '../delivery/task-commands.ts';
import { createRiskRecord } from '../risk/risk-commands.ts';

export type ReviewDecision = 'accepted' | 'rejected';
export type ProgressReviewInput = {
  idempotencyKey:string;
  decision:ReviewDecision;
};
export type ProposalReviewInput = ProgressReviewInput & {
  assigneeId:string|null;
  dueDate?:string|null;
};

function fail(statusCode:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode});
}

/** One human authorization, receipt, audit and Outbox transaction per review.
 * AI analyses only create pending evidence; they never commit official work.
 */
export async function decideProgress(
  projectId:string,progressId:string,actorId:string,v:ProgressReviewInput,
){
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
}

/** Accepting a proposal delegates inserts to the single Task/Risk owners. */
export async function decideProposal(
  projectId:string,proposalId:string,actorId:string,v:ProposalReviewInput,
){
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
            const task=await createTaskRecord(db,projectId,{
              title:proposal.title,detail:proposal.detail,
              assigneeId:v.assigneeId,dueDate:v.dueDate,
              sourceDueAt:proposal.clarified_due_at??proposal.due_at,
              sourceProposalId:proposal.id,
            });
            createdTaskId=task.id;
          }else{
            const risk=await createRiskRecord(db,projectId,{
              title:proposal.title,detail:proposal.detail,
              sourceProposalId:proposal.id,
            });
            createdRiskId=risk.id;
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
}
