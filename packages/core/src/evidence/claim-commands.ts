import { pool } from '../db.ts';
import { executePmCommand } from '../pm-command.ts';
import { canProject } from '../permissions.ts';

export type ClaimKind='work_progress'|'completion_claim'|'commitment'|'blocker'|
  'risk_signal'|'issue_signal'|'decision_signal'|'change_signal'|'observation';

function deny(statusCode:number,message:string):never{
  throw Object.assign(new Error(message),{statusCode});
}
export type CreateClaimInput={
  projectId:string;actorId:string;idempotencyKey:string;messageId:string;
  startCp:number;endCp:number;kind:ClaimKind;summary:string;
};

/** A claim records the speaker's words, NOT a formally accepted PM fact. */
export async function createEvidenceClaim(input:CreateClaimInput){
  const {projectId,actorId,idempotencyKey,messageId,startCp,endCp,kind,summary}=input;
  return executePmCommand({
    projectId,actorId,idempotencyKey,kind:'evidence.claim.created.v1',
    action:'read',payload:{messageId,startCp,endCp,kind,summary},
    mutate:async(db,role)=>{
      const source=await db.query<{content:string;author_id:string|null;kind:string}>(`
        SELECT content,author_id,kind FROM messages
        WHERE project_id=$1 AND id=$2 FOR SHARE
      `,[projectId,messageId]);
      const m=source.rows[0];
      if(!m)deny(404,'原始消息不存在或不属于本项目');
      if(m.kind!=='user'||!m.author_id)deny(400,'只允许引用项目成员原始发言');
      if(!canProject(role,'pm.plan')&&
         !(m.author_id===actorId&&canProject(role,'message.write')))
        deny(403,'只能记录自己的发言或由项目管理者登记其他人发言');
      const codepoints=Array.from(m.content);
      if(startCp<0||endCp<=startCp||endCp>codepoints.length||endCp-startCp>2000)
        deny(400,'证据片段范围不合法');
      const quote=codepoints.slice(startCp,endCp).join('');
      if(!quote.trim())deny(400,'证据片段不能为空');
      const saved=await db.query<{id:string;quote:string}>(`
        INSERT INTO project_evidence_spans(project_id,source_message_id,
          start_cp,end_cp,quote,created_by)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(project_id,source_message_id,start_cp,end_cp) DO NOTHING
        RETURNING id,quote
      `,[projectId,messageId,startCp,endCp,quote,actorId]);
      const evidence=saved.rows[0]??(await db.query<{id:string;quote:string}>(`
        SELECT id,quote FROM project_evidence_spans
        WHERE project_id=$1 AND source_message_id=$2 AND start_cp=$3 AND end_cp=$4
      `,[projectId,messageId,startCp,endCp])).rows[0];
      if(!evidence||evidence.quote!==quote)
        deny(409,'源消息发生变化，请重新核对证据引用');
      const created=await db.query(`
        INSERT INTO project_claims(project_id,evidence_id,kind,summary,created_by)
        VALUES($1,$2,$3,$4,$5) RETURNING *
      `,[projectId,evidence.id,kind,summary,actorId]);
      const claim=created.rows[0] as Record<string,unknown>;
      return {response:{claim,evidence:{id:evidence.id,quote}},
        aggregateType:'project_claims',aggregateId:claim.id as string,
        aggregateVersion:1};
    },
  });
}
export type ReviewClaimInput={
  projectId:string;actorId:string;idempotencyKey:string;
  claimId:string;expectedVersion:number;decision:'acknowledge'|'dismiss';
};
export async function reviewEvidenceClaim(input:ReviewClaimInput){
  const {projectId,actorId,idempotencyKey,claimId,expectedVersion,decision}=input;
  return executePmCommand({
    projectId,actorId,idempotencyKey,kind:'evidence.claim.reviewed.v1',
    action:'read',payload:{claimId,expectedVersion,decision},
    mutate:async(db,role)=>{
      const {rows}=await db.query<{id:string;version:number;status:string;author_id:string|null}>(`
        SELECT c.id,c.version,c.status,m.author_id FROM project_claims c
        JOIN project_evidence_spans e ON e.project_id=c.project_id AND e.id=c.evidence_id
        JOIN messages m ON m.project_id=e.project_id AND m.id=e.source_message_id
        WHERE c.project_id=$1 AND c.id=$2 FOR UPDATE OF c
      `,[projectId,claimId]);
      const c=rows[0];
      if(!c)deny(404,'主张不存在或不属于本项目');
      if(c.status!=='pending')deny(409,'该主张已审核');
      if(c.version!==expectedVersion)deny(409,'主张版本冲突');
      if(decision==='acknowledge'){
        // A manager cannot acknowledge another person's actual commitment.
        if(c.author_id!==actorId||!canProject(role,'message.write'))
          deny(403,'只能由原始发言人确认自己的表述');
      }else if(!canProject(role,'pm.plan')){
        deny(403,'只有项目负责人或管理者可以驳回主张');
      }
      const status=decision==='acknowledge'?'source_acknowledged':'dismissed';
      const updated=await db.query(`
        UPDATE project_claims SET status=$3,reviewed_by=$4,reviewed_at=NOW(),
          version=version+1
        WHERE project_id=$1 AND id=$2 RETURNING *
      `,[projectId,claimId,status,actorId]);
      const claim=updated.rows[0] as Record<string,unknown>;
      return {response:{claim},aggregateType:'project_claims',
        aggregateId:claimId,aggregateVersion:Number(claim.version)};
    },
  });
}
export async function listEvidenceClaims(input:{
  projectId:string;actorId:string;beforeAt?:string;beforeId?:string;
}){
  const {projectId,actorId,beforeAt,beforeId}=input;
  const access=await pool.query(`
    SELECT 1 FROM projects p
    JOIN project_members pm ON pm.project_id=p.id AND pm.user_id=$2
    JOIN tenant_members tm ON tm.tenant_id=p.tenant_id AND tm.user_id=$2
    WHERE p.id=$1
  `,[projectId,actorId]);
  if(!access.rowCount)deny(404,'项目不存在或无权限');
  const {rows}=await pool.query<{
    id:string;created_at:Date;evidence_id:string;source_message_id:string;
    author_id:string|null;quote:string;kind:ClaimKind;summary:string;
    status:string;version:number;created_by:string;reviewed_by:string|null;
  }>(`
    SELECT c.id,c.created_at,c.evidence_id,c.kind,c.summary,c.status,c.version,
      c.created_by,c.reviewed_by,e.source_message_id,e.quote,m.author_id
    FROM project_claims c
    JOIN project_evidence_spans e ON e.project_id=c.project_id AND e.id=c.evidence_id
    JOIN messages m ON m.project_id=e.project_id AND m.id=e.source_message_id
    WHERE c.project_id=$1
      AND ($2::timestamptz IS NULL OR
        (c.created_at,c.id)<($2::timestamptz,$3::uuid))
    ORDER BY c.created_at DESC,c.id DESC LIMIT 51
  `,[projectId,beforeAt??null,beforeId??null]);
  return {claims:rows.slice(0,50),nextCursor:rows.length>50
    ?{beforeAt:rows[49].created_at,beforeId:rows[49].id}:null};
}
