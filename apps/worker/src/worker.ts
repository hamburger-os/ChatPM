import 'dotenv/config';
import { processReminders } from '../../../packages/core/src/automation/reminder-runner.ts';
import { processReports } from '../../../packages/core/src/reporting/period-runner.ts';
import { pool, transaction, audit } from '../../../packages/core/src/db.ts';
import { insertMessage } from '../../../packages/core/src/messages.ts';
import { ConfiguredLLMProvider } from '../../../packages/core/src/ai-provider.ts';
import { processClarification } from '../../../packages/core/src/clarification.ts';
import { isDuplicateActiveTask } from '../../../packages/core/src/task-progress.ts';
import { projectAnalysisContext } from '../../../packages/core/src/project-context.ts';
import { resolveProjectModel } from '../../../packages/core/src/project-model.ts';
import { claimEvents, finishEvent, failEvent, type EventRow } from '../../../packages/core/src/outbox.ts';

type AnalysisResult={kind:'extract'|'clarify'|'reply';status:'proposal'|'no_change'|'clarified'|'replied';modelName?:string};
async function recordAnalysis(event:EventRow,kind:'extract'|'clarify'|'reply',
  status:'processing'|'proposal'|'no_change'|'clarified'|'replied'|'failed',modelName?:string,errorCode?:string){
  await pool.query(`INSERT INTO ai_analysis_runs(
    project_id,source_message_id,kind,status,model_name,error_code)
    VALUES($1,$2,$3,$4,$5,$6)
    ON CONFLICT(project_id,source_message_id) DO UPDATE SET
      kind=EXCLUDED.kind,status=EXCLUDED.status,model_name=EXCLUDED.model_name,
      error_code=EXCLUDED.error_code,updated_at=NOW()`,
    [event.project_id,event.message_id,kind,status,modelName??null,errorCode??null]);
}
async function runAnalysis(event:EventRow):Promise<AnalysisResult|null> {
  if(event.kind!=='message.created') throw new Error('UNSUPPORTED_EVENT_KIND');
  if(!event.message_id) throw new Error('EVENT_MISSING_MESSAGE');
  const lookup=await pool.query(
    `SELECT m.kind,m.content,p.name,p.ai_enabled FROM messages m
     JOIN projects p ON p.id=m.project_id WHERE m.id=$1 AND m.project_id=$2`,
    [event.message_id,event.project_id],
  );
  const msg=lookup.rows[0] as {kind:string,content:string,name:string,ai_enabled:boolean}|undefined;
  if(!msg || msg.kind!=='user'||!msg.ai_enabled) return null;
  const kind=/(?:^|\s)@AI(?:\s|$|[：:，,])/iu.test(msg.content)?'reply':'extract';
  await recordAnalysis(event,kind,'processing');
  if(kind==='reply'){
    const settings=await resolveProjectModel(event.project_id);
    const context=await projectAnalysisContext(event.project_id,event.message_id,
      Math.max(1200,(Math.max(1200,(settings.contextChars??6500)-500))-500));
    const result=await new ConfiguredLLMProvider(event.project_id).respond(msg.name,context);
    await transaction(async db=>{
      await insertMessage(db,{projectId:event.project_id,authorId:null,kind:'ai',
        content:result.value.reply,nonce:'reply:'+event.id});
      await audit(db,event.project_id,null,'ai.reply_created',event.id,
        {sourceMessageId:event.message_id,modelName:result.modelName});
    });
    return {kind:'reply',status:'replied',modelName:result.modelName};
  }
  if(await processClarification({id:event.message_id,projectId:event.project_id,
    content:msg.content,projectName:msg.name}))
    return {kind:'clarify',status:'clarified'};
  const existing=await pool.query(
    `SELECT 1 FROM proposed_changes WHERE project_id=$1 AND source_message_id=$2
     UNION ALL SELECT 1 FROM task_progress_updates
     WHERE project_id=$1 AND source_message_id=$2 LIMIT 1`,
    [event.project_id,event.message_id]);
  if(existing.rowCount)return {kind:'extract',status:'proposal'};
  const settings=await resolveProjectModel(event.project_id);
  const context=await projectAnalysisContext(event.project_id,event.message_id,
    Math.max(1200,(settings.contextChars??6500)-1200));
  const output=await new ConfiguredLLMProvider(event.project_id).analyzeWork(msg.name,context);
  const suggestions=output.value.items;
  const progress=output.value.progress;
  if(!suggestions.length&&!progress.length)return {kind:'extract',status:'no_change',modelName:output.modelName};
  const known=await pool.query(`SELECT id,title FROM tasks
    WHERE project_id=$1 AND status NOT IN ('done','cancelled')`,[event.project_id]);
  const matching=new Map(known.rows.map(r=>[r.id as string,r.title as string]));

  const total=await transaction(async db=>{
    let added=0,progressAdded=0;
    const questions:string[]=[];
    const usedTasks=new Set<string>();
    for(const suggestion of progress){
      if(!matching.has(suggestion.task_id)||usedTasks.has(suggestion.task_id))continue;
      const inserted=await db.query(`INSERT INTO task_progress_updates(
        project_id,task_id,source_message_id,summary,kind,model_name,prompt_version)
        SELECT $1,t.id,$3,$4,$5,$6,$7 FROM tasks t
        WHERE t.project_id=$1 AND t.id=$2 AND t.status NOT IN ('done','cancelled')
        ON CONFLICT(project_id,task_id,source_message_id) DO NOTHING RETURNING id`,
        [event.project_id,suggestion.task_id,event.message_id,suggestion.summary,
          suggestion.kind,output.modelName,output.promptVersion]);
      progressAdded+=inserted.rowCount??0;
      usedTasks.add(suggestion.task_id);
    }
    for(const item of suggestions) {
      // Exact/contained normalized titles cannot create a second active task.
      // Ambiguous semantic matches stay human-reviewed; never auto-merge by fuzzy score.
      if(item.kind==='task'){
        const candidates=known.rows.filter(t=>isDuplicateActiveTask(item.title,[t.title]));
        if(candidates.length){
          // When the model emits a duplicate "new task" instead of a progress link,
          // a unique normalized match becomes pending evidence, never a formal update.
          if(candidates.length===1&&!usedTasks.has(candidates[0].id)){
            const saved=await db.query(`INSERT INTO task_progress_updates(
              project_id,task_id,source_message_id,summary,kind,model_name,prompt_version)
              SELECT $1,t.id,$3,$4,'progress',$5,$6 FROM tasks t
              WHERE t.project_id=$1 AND t.id=$2 AND t.status NOT IN ('done','cancelled')
              ON CONFLICT(project_id,task_id,source_message_id) DO NOTHING RETURNING id`,
              [event.project_id,candidates[0].id,event.message_id,msg.content.slice(0,2000),
                output.modelName,output.promptVersion]);
            progressAdded+=saved.rowCount??0;
            usedTasks.add(candidates[0].id);
          }
          continue;
        }
      }
      const result=await db.query(
        `INSERT INTO proposed_changes(
           project_id,source_message_id,kind,title,detail,due_at,assignee_hint,confidence,
           model_name,prompt_version,evidence_text
         ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT(project_id,source_message_id,kind,title) DO NOTHING RETURNING id`,
        [event.project_id,event.message_id,item.kind,item.title,
          item.detail,item.due_at,item.assignee_hint,item.confidence,
          output.modelName,output.promptVersion,msg.content.slice(0,1000)]);
      if(result.rows[0] && item.kind==='task' && (!item.assignee_hint||!item.due_at)){
        const ref=result.rows[0].id as string;
        await db.query(
          `INSERT INTO clarification_threads(proposal_id,project_id) VALUES($1,$2)
           ON CONFLICT(proposal_id) DO NOTHING`,[ref,event.project_id]);
        const missing=[
          !item.assignee_hint?'由谁负责':'',!item.due_at?'计划何时完成':'',
        ].filter(Boolean).join('、');
        questions.push('关于「'+item.title+'」【候选:'+ref+'】，请回复此编号并确认'+missing+'？');
      }
      added+=result.rowCount??0;
    }
    if(added||progressAdded) {
      const content=(progressAdded?'已将 '+progressAdded+' 条进展关联到已有任务，等待负责人在「任务」中核对。':'')+
        (added?'另有 '+added+' 项新任务或风险候选，负责人可在「AI 待确认」中审核。':'')+
        (questions.length?'\n'+questions.slice(0,2).join('\n'):'');
      await insertMessage(db,{
        projectId:event.project_id,authorId:null,kind:'ai',
        content,nonce:'analysis:'+event.id,
      });
      await audit(db,event.project_id,null,'ai.proposals_created',event.id,
        {sourceMessageId:event.message_id,count:added,progressCount:progressAdded});
    }
    return added+progressAdded;
  });
  return {kind:'extract',status:total>0?'proposal':'no_change',modelName:output.modelName};
}

async function processEvents() {
  const events=await claimEvents();
  for(const event of events) {
    try {
      if(event.kind==='domain.changed'){
        // Record-only domain events have no automatic AI side effects.
        // Ensure an actual same-project event exists before acknowledging.
        const eventId=(await pool.query<{id:string}>(`
          SELECT d.id FROM domain_events d JOIN outbox_events o
            ON o.project_id=d.project_id
          WHERE o.id=$1 AND o.project_id=$2 AND d.id=(o.payload->>'domainEventId')::uuid
        `,[event.id,event.project_id])).rows[0]?.id;
        if(!eventId)throw new Error('DOMAIN_EVENT_NOT_FOUND');
        await finishEvent(event);
        continue;
      }
      const result=await runAnalysis(event);
      if(result && event.message_id)
        await recordAnalysis(event,result.kind,result.status,result.modelName);
      await finishEvent(event);
    }catch(err) {
      if(event.message_id){
        const code=err instanceof Error && /^(?:MODEL_|AI_AUTHORIZATION_)[A-Z0-9_]+$/.test(err.message)
          ?err.message:err instanceof Error&&err.name==='ZodError'?'MODEL_SCHEMA':err instanceof Error?err.name.slice(0,60):'UNKNOWN_FAILURE';
        try {await recordAnalysis(event,'extract','failed',undefined,code);}
        catch { /* Event failure still flows through the outbox retry state. */ }
      }
      // A revoked run is cancelled, not retried after someone re-enables AI.
      if(err instanceof Error&&/^AI_AUTHORIZATION_(?:REVOKED|CHANGED)$/.test(err.message)){
        await finishEvent(event);
        continue;
      }
      await failEvent(event,err);
      console.error('Outbox event failed',event.id,
        err instanceof Error?err.name:'UnknownFailure');
    }
  }
}


let busy=false;
let lastReportScanSlot=-1;
async function tick() {
  if(busy)return;
  busy=true;
  let succeeded=false;
  try {
    await processEvents();
    await processReminders();
    // Bounded catch-up scan once per 5-minute slot; DB lock prevents duplicates.
    const slot=Math.floor(Date.now()/300000);
    if(lastReportScanSlot!==slot){
      await processReports();
      lastReportScanSlot=slot;
    }
    succeeded=true;
  }
  catch(e) { console.error('Worker tick failed',e instanceof Error?e.message:e); }
  finally {
    try {
      await pool.query(`INSERT INTO worker_health(name,last_seen_at,last_success_at,last_failure_at)
        VALUES('default',NOW(),CASE WHEN $1::boolean THEN NOW() ELSE NULL END,
          CASE WHEN $1::boolean THEN NULL ELSE NOW() END)
        ON CONFLICT (name) DO UPDATE SET
          last_seen_at=NOW(),
          last_success_at=CASE WHEN $1::boolean THEN NOW() ELSE worker_health.last_success_at END,
          last_failure_at=CASE WHEN $1::boolean THEN worker_health.last_failure_at ELSE NOW() END`,
        [succeeded]);
    } catch(e) {
      console.error('Worker heartbeat failed',e instanceof Error?e.name:'UnknownFailure');
    }
    busy=false;
  }
}
console.log('ChatPM worker started: reliable outbox, reminders and report drafts.');
let activeTick:Promise<void>|null=null;
let stopping=false;
function scheduleTick(){
  if(stopping || activeTick)return;
  activeTick=tick().finally(()=>{activeTick=null;});
}
const timer=setInterval(scheduleTick,15000);
async function shutdown(){
  if(stopping)return;
  stopping=true;
  clearInterval(timer);
  if(activeTick)await activeTick;
  await pool.end();
  if (process.connected) process.disconnect();
}
// The one-terminal runner uses IPC on Windows because SIGTERM forcibly terminates Node there.
if (process.send) {
  process.on('message', (message: unknown) => {
    if (message && typeof message === 'object' &&
        'type' in message && message.type === 'chatpm:shutdown') {
      void shutdown().then(() => {
        if (process.connected) process.disconnect();
      }).catch(e => { console.error('IPC shutdown failed', e); process.exitCode=1; });
    }
  });
}
process.once('SIGTERM',()=>{void shutdown().catch(e=>{console.error('Shutdown failed',e);process.exitCode=1;});});
process.once('SIGINT',()=>{void shutdown().catch(e=>{console.error('Shutdown failed',e);process.exitCode=1;});});
scheduleTick();
