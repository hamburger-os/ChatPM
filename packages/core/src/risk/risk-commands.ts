import {executePmCommand} from '../pm-command.ts';
import type {DbClient} from '../db.ts';

type Decision='start_mitigation'|'resolve'|'reopen';
export type RiskAssessmentInput={
  idempotencyKey:string;expectedVersion:number;
  likelihood:number;impact:number;ownerId:string;
  responsePlan:string;note:string;
};
export type RiskTransitionInput={
  idempotencyKey:string;expectedVersion:number;
  decision:Decision;note:string;
};
function fail(statusCode:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode});
}
async function assertActiveRiskOwner(db:DbClient,projectId:string,ownerId:string){
  const {rowCount}=await db.query(`
    SELECT 1 FROM project_members pm
    JOIN projects p ON p.id=pm.project_id
    JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
    WHERE pm.project_id=$1 AND pm.user_id=$2 AND pm.role<>'observer'
    FOR SHARE OF pm,tm`,[projectId,ownerId]);
  if(!rowCount)fail(400,'风险负责人必须是当前项目和组织的可执行成员');
}
async function recordRiskHistory(db:DbClient,
  projectId:string,riskId:string,riskVersion:number,
  action:'assessment'|'transition',fromStatus:string,toStatus:string,
  note:string,actorId:string,
){
  await db.query(`
    INSERT INTO risk_register_changes(project_id,risk_id,risk_version,
      action,from_status,to_status,note,actor_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
  `,[projectId,riskId,riskVersion,action,fromStatus,toStatus,note,actorId]);
}

/** Risk is prospective uncertainty, distinct from an occurred Issue.
 * Every official update is a PM command, with receipt, domain event and Outbox.
 */
export async function assessRisk(
  projectId:string,riskId:string,actorId:string,input:RiskAssessmentInput,
){
  return executePmCommand({
    projectId,actorId,action:'pm.plan',kind:'risk.assessed.v1',
    idempotencyKey:input.idempotencyKey,payload:{riskId,...input},
    mutate:async db=>{
      const before=(await db.query<{version:number;status:string}>(`
        SELECT version,status FROM risks
        WHERE project_id=$1 AND id=$2 FOR UPDATE
      `,[projectId,riskId])).rows[0];
      if(!before)fail(404,'风险不存在');
      if(before.version!==input.expectedVersion)fail(409,'风险版本冲突');
      if(before.status==='resolved')fail(409,'已关闭风险需先重新打开');
      await assertActiveRiskOwner(db,projectId,input.ownerId);
      const {rows}=await db.query(`
        UPDATE risks SET likelihood=$3,impact=$4,owner_id=$5,
          response_plan=$6,version=version+1,updated_at=NOW()
        WHERE project_id=$1 AND id=$2 RETURNING *
      `,[projectId,riskId,input.likelihood,input.impact,input.ownerId,
        input.responsePlan]);
      const item=rows[0] as {id:string;version:number};
      await recordRiskHistory(db,projectId,riskId,item.version,
        'assessment',before.status,before.status,input.note,actorId);
      return {response:{risk:item},aggregateType:'risks',
        aggregateId:riskId,aggregateVersion:item.version,
        auditDetails:{action:'assessment',likelihood:input.likelihood,
          impact:input.impact,ownerId:input.ownerId}};
    },
  });
}
export function riskTarget(
  current:string,decision:Decision,
):'open'|'mitigating'|'resolved'{
  const target=decision==='start_mitigation'?'mitigating':
    decision==='resolve'?'resolved':'open';
  const valid=(current==='open'&&target==='mitigating')||
    (current==='mitigating'&&target==='resolved')||
    (current==='resolved'&&target==='open');
  if(!valid)fail(409,'风险状态流转不符合管理流程');
  return target;
}
export async function transitionRisk(
  projectId:string,riskId:string,actorId:string,input:RiskTransitionInput,
){
  return executePmCommand({
    projectId,actorId,action:'pm.plan',kind:'risk.transitioned.v1',
    idempotencyKey:input.idempotencyKey,payload:{riskId,...input},
    mutate:async db=>{
      const before=(await db.query<{
        version:number;status:string;owner_id:string|null;
        likelihood:number|null;impact:number|null;response_plan:string;
      }>(`
        SELECT version,status,owner_id,likelihood,impact,response_plan
        FROM risks WHERE project_id=$1 AND id=$2 FOR UPDATE
      `,[projectId,riskId])).rows[0];
      if(!before)fail(404,'风险不存在');
      if(before.version!==input.expectedVersion)fail(409,'风险版本冲突');
      const target=riskTarget(before.status,input.decision);
      if(target==='mitigating'){
        if(before.likelihood===null||before.impact===null||
           !before.response_plan.trim()||!before.owner_id)
          fail(409,'应对前必须明确风险评估、责任人和应对计划');
        await assertActiveRiskOwner(db,projectId,before.owner_id);
      }
      const updated=await db.query(`
        UPDATE risks SET status=$3,version=version+1,updated_at=NOW()
        WHERE project_id=$1 AND id=$2 RETURNING *
      `,[projectId,riskId,target]);
      const item=updated.rows[0] as {id:string;version:number};
      await recordRiskHistory(db,projectId,riskId,item.version,
        'transition',before.status,target,input.note,actorId);
      return {response:{risk:item},aggregateType:'risks',
        aggregateId:riskId,aggregateVersion:item.version,
        auditDetails:{action:input.decision,fromStatus:before.status,toStatus:target}};
    },
  });
}
