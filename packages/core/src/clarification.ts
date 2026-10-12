import { pool, transaction, audit } from './db.ts';
import { OpenAIProvider } from './ai-provider.ts';
import { insertMessage } from './messages.ts';

const REFERENCE=/【候选:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})】/i;
export function referencedCandidate(text:string):string|null{
  return REFERENCE.exec(text)?.[1]?.toLowerCase()??null;
}

type Reply={id:string;projectId:string;content:string;projectName:string};
export async function processClarification(reply:Reply):Promise<boolean>{
  const proposalId=referencedCandidate(reply.content);
  if(!proposalId)return false;
  const {rows}=await pool.query(`SELECT p.id,p.title,t.status
    FROM proposed_changes p JOIN clarification_threads t ON t.proposal_id=p.id
    WHERE p.id=$1 AND p.project_id=$2 AND p.status='pending' AND t.status IN ('open','answered')`,
    [proposalId,reply.projectId]);
  if(!rows.length)return true; // Explicit reference: never create an unrelated proposal.
  const result=await new OpenAIProvider(reply.projectId).clarify(reply.projectName,rows[0].title,reply.content);
  const suggestion=result.value;
  if(!suggestion.assignee_hint&&!suggestion.due_at)return true;
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
        content:'已记录【候选:'+proposalId+'】的补充线索，请项目负责人在「AI 待确认」中核对；我不会自行更改正式任务。',
        nonce:'clarification:'+reply.id,
      });
      await audit(db,reply.projectId,null,'ai.clarification_recorded',proposalId,
        {messageId:reply.id,versioned:true,promptVersion:result.promptVersion});
    }
  });
  return true;
}
