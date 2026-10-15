import type {FastifyInstance,FastifyRequest} from 'fastify';
import {z} from 'zod';
import {pool} from '../../../packages/core/src/db.ts';
import {executePmCommand} from '../../../packages/core/src/pm-command.ts';

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
function fail(statusCode:number,message:string):never {
  throw Object.assign(new Error(message),{statusCode});
}
function context(req:FastifyRequest):{projectId:string;riskId:string}{
  const p=req.params as {id:string;riskId?:string};
  return {projectId:uuid.parse(p.id),riskId:p.riskId?uuid.parse(p.riskId):''};
}
async function authorizeRead(projectId:string,actorId:string):Promise<void>{
  const r=await pool.query(`
    SELECT 1 FROM projects p
    JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
    JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=$2
    WHERE p.id=$1
  `,[projectId,actorId]);
  if(!r.rowCount)fail(404,'项目不存在或无权限');
}
async function activeOwner(db:import('../../../packages/core/src/db.ts').DbClient,
  projectId:string,ownerId:string):Promise<void>{
  const r=await db.query(`
    SELECT 1 FROM project_members pm
    JOIN projects p ON p.id=pm.project_id
    JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=pm.user_id
    WHERE pm.project_id=$1 AND pm.user_id=$2 AND pm.role<>'observer'
    FOR SHARE OF pm,tm
  `,[projectId,ownerId]);
  if(!r.rowCount)fail(400,'风险负责人必须是当前项目和组织的可执行成员');
}
async function recordHistory(db:import('../../../packages/core/src/db.ts').DbClient,
  projectId:string,riskId:string,riskVersion:number,
  action:'assessment'|'transition',fromStatus:string,toStatus:string,
  note:string,actorId:string):Promise<void>{
  await db.query(`
    INSERT INTO risk_register_changes(project_id,risk_id,risk_version,
      action,from_status,to_status,note,actor_id)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8)
  `,[projectId,riskId,riskVersion,action,fromStatus,toStatus,note,actorId]);
}

/** Risk is prospective uncertainty, not an occurred Issue.
 * AI-approved risk candidates start open/unassessed and cannot self-resolve.
 */
export function registerRiskRoutes(
  app:FastifyInstance,authenticated:(req:FastifyRequest)=>Promise<string>,
):void{
  app.get('/projects/:id/risks',async req=>{
    const {projectId}=context(req),actorId=await authenticated(req);
    await authorizeRead(projectId,actorId);
    return {risks:(await pool.query(`
      SELECT * FROM risks WHERE project_id=$1
      ORDER BY created_at DESC LIMIT 200
    `,[projectId])).rows};
  });

  app.patch('/projects/:id/risks/:riskId/assessment',async req=>{
    const {projectId,riskId}=context(req),actorId=await authenticated(req);
    const input=assessment.parse(req.body);
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
        await activeOwner(db,projectId,input.ownerId);
        const updated=await db.query(`
          UPDATE risks SET likelihood=$3,impact=$4,owner_id=$5,
            response_plan=$6,version=version+1,updated_at=NOW()
          WHERE project_id=$1 AND id=$2 RETURNING *
        `,[projectId,riskId,input.likelihood,input.impact,input.ownerId,
          input.responsePlan]);
        const item=updated.rows[0];
        await recordHistory(db,projectId,riskId,item.version,
          'assessment',before.status,before.status,input.note,actorId);
        return {response:{risk:item},aggregateType:'risks',
          aggregateId:riskId,aggregateVersion:item.version,
          auditDetails:{action:'assessment',likelihood:input.likelihood,
            impact:input.impact,ownerId:input.ownerId}};
      },
    });
  });
  app.post('/projects/:id/risks/:riskId/transition',async req=>{
    const {projectId,riskId}=context(req),actorId=await authenticated(req);
    const input=transition.parse(req.body);
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
        const target=input.decision==='start_mitigation'?'mitigating':
          input.decision==='resolve'?'resolved':'open';
        const valid=(before.status==='open'&&target==='mitigating')||
          (before.status==='mitigating'&&target==='resolved')||
          (before.status==='resolved'&&target==='open');
        if(!valid)fail(409,'风险状态流转不符合管理流程');
        if(target==='mitigating'){
          if(before.likelihood===null||before.impact===null||
             !before.response_plan.trim()||!before.owner_id)
            fail(409,'应对前必须明确风险评估、责任人和应对计划');
          await activeOwner(db,projectId,before.owner_id);
        }
        const updated=await db.query(`
          UPDATE risks SET status=$3,version=version+1,updated_at=NOW()
          WHERE project_id=$1 AND id=$2 RETURNING *
        `,[projectId,riskId,target]);
        const item=updated.rows[0];
        await recordHistory(db,projectId,riskId,item.version,
          'transition',before.status,target,input.note,actorId);
        return {response:{risk:item},aggregateType:'risks',
          aggregateId:riskId,aggregateVersion:item.version,
          auditDetails:{action:input.decision,fromStatus:before.status,toStatus:target}};
      },
    });
  });

  app.get('/projects/:id/risks/:riskId/history',async req=>{
    const {projectId,riskId}=context(req),actorId=await authenticated(req);
    await authorizeRead(projectId,actorId);
    const exists=await pool.query(`
      SELECT 1 FROM risks WHERE project_id=$1 AND id=$2
    `,[projectId,riskId]);
    if(!exists.rowCount)fail(404,'风险不存在');
    const q=z.object({beforeVersion:z.coerce.number().int().positive().optional()})
      .parse(req.query);
    const {rows}=await pool.query(`
      SELECT id,risk_version,action,from_status,to_status,note,actor_id,occurred_at
      FROM risk_register_changes
      WHERE project_id=$1 AND risk_id=$2
        AND risk_version<COALESCE($3::int,2147483647)
      ORDER BY risk_version DESC LIMIT 51
    `,[projectId,riskId,q.beforeVersion??null]);
    return {history:rows.slice(0,50),
      nextBeforeVersion:rows.length>50?rows[49].risk_version:null};
  });
}
