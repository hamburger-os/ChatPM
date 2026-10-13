import { pool, transaction, audit } from './db.ts';
import { ConfiguredLLMProvider } from './ai-provider.ts';
import { insertMessage } from './messages.ts';

const REFERENCE=/【候选:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})】/i;
export function referencedCandidate(text:string):string|null{
  return REFERENCE.exec(text)?.[1]?.toLowerCase()??null;
}

type Reply={id:string;projectId:string;content:string;projectName:string};
export async function processClarification(reply:Reply):Promise<boolean>{
  let proposalId=referencedCandidate(reply.content);
  if(!proposalId){
    if(!/(负责人|负责|截止|完成时间|交付日期|计划于|月底|本周|下周|\d+月|[一二三四五六七八九十]+月)/u.test(reply.content))return false;
    const recent=await pool.query(`SELECT t.proposal_id FROM clarification_threads t
      JOIN proposed_changes p ON p.id=t.proposal_id
      JOIN messages ai ON ai.project_id=p.project_id AND ai.kind='ai'
        AND ai.content LIKE '%' || t.proposal_id::text || '%'
      WHERE t.project_id=$1 AND t.status IN ('open','answered') AND p.status='pending'
        AND ai.created_at>NOW()-INTERVAL '30 minutes'
        AND ai.seq<(SELECT seq FROM messages WHERE id=$2 AND project_id=$1)
        AND NOT EXISTS (
          SELECT 1 FROM messages later
          WHERE later.project_id=$1 AND later.kind='user' AND later.seq>ai.seq
            AND later.seq<(SELECT seq FROM messages WHERE id=$2 AND project_id=$1)
        )
      GROUP BY t.proposal_id ORDER BY MAX(ai.seq) DESC LIMIT 2`,[reply.projectId,reply.id]);
    // Only a single, recently asked clarification is safe to infer.
    if(recent.rows.length!==1)return false;
    proposalId=recent.rows[0].proposal_id as string;
  }
  const {rows}=await pool.query(`SELECT p.id,p.title,t.status
    FROM proposed_changes p JOIN clarification_threads t ON t.proposal_id=p.id
    WHERE p.id=$1 AND p.project_id=$2 AND p.status='pending' AND t.status IN ('open','answered')`,
    [proposalId,reply.projectId]);
  if(!rows.length){
    await transaction(async db=>{
      await insertMessage(db,{
        projectId:reply.projectId,authorId:null,kind:'ai',
        content:'我没找到这条待确认候选，可能已处理或不属于当前项目。请从「AI 待确认」选择正确事项继续补充。',
        nonce:'clarification-not-found:'+reply.id,
      });
    });
    return true;
  }
  const processed=await pool.query(
    'SELECT 1 FROM clarification_responses WHERE proposal_id=$1 AND message_id=$2',
    [proposalId,reply.id]);
  if(processed.rowCount)return true; // A redelivered event never spends budget twice.
  const result=await new ConfiguredLLMProvider(reply.projectId).clarify(reply.projectName,rows[0].title,reply.content);
  const suggestion=result.value;
  if(!suggestion.assignee_hint&&!suggestion.due_at){
    await transaction(async db=>{
      const saved=await db.query(`INSERT INTO clarification_responses(
        project_id,proposal_id,message_id,model_name,prompt_version,assignee_hint,due_at,confidence)
        VALUES($1,$2,$3,$4,$5,NULL,NULL,$6)
        ON CONFLICT(proposal_id,message_id) DO NOTHING RETURNING id`,
        [reply.projectId,proposalId,reply.id,result.modelName,
          result.promptVersion,suggestion.confidence]);
      if(!saved.rowCount)return;
      await insertMessage(db,{
        projectId:reply.projectId,authorId:null,kind:'ai',
        content:'已收到【候选:'+proposalId+'】的回复，但目前还无法确认负责人或包含确切年份及时区的期限。请补充明确的信息，我不会猜测。',
        nonce:'clarification-needs-detail:'+reply.id,
      });
    });
    return true;
  }
  await transaction(async db=>{
    const {rows:written}=await db.query(`INSERT INTO clarification_responses(
      project_id,proposal_id,message_id,model_name,prompt_version,assignee_hint,due_at,confidence)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE EXISTS(
        SELECT 1 FROM proposed_changes WHERE id=$2 AND project_id=$1 AND status='pending')
      ON CONFLICT(proposal_id,message_id) DO NOTHING RETURNING id`,
      [reply.projectId,proposalId,reply.id,result.modelName,result.promptVersion,
       suggestion.assignee_hint,suggestion.due_at,suggestion.confidence]);
    if(!written.length)return;
    const {rowCount}=await db.query(`UPDATE clarification_threads t SET
      status='answered',response_message_id=$3,
      assignee_hint=COALESCE($4,t.assignee_hint),due_at=COALESCE($5,t.due_at),
      confidence=$6,version=version+1,updated_at=NOW()
      FROM proposed_changes p WHERE t.proposal_id=$1 AND t.project_id=$2
      AND p.id=t.proposal_id AND p.status='pending' AND t.status<>'closed'`,
      [proposalId,reply.projectId,reply.id,suggestion.assignee_hint,
        suggestion.due_at,suggestion.confidence]);
    if(rowCount){
      await insertMessage(db,{
        projectId:reply.projectId,authorId:null,kind:'ai',
        content:'已记录【候选:'+proposalId+'】的补充线索：'+
          (suggestion.assignee_hint?'负责人线索已收到；':'负责人仍需确认；')+
          (suggestion.due_at?'截止时间线索已收到；':'期限仍需补充确切年份、时区与时间；')+
          '请负责人在「AI 待确认」中核对，我不会自行更改正式任务。',
        nonce:'clarification:'+reply.id,
      });
      await audit(db,reply.projectId,null,'ai.clarification_recorded',proposalId,
        {messageId:reply.id,versioned:true,promptVersion:result.promptVersion});
    }
  });
  return true;
}
