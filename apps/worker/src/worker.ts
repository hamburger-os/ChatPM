import 'dotenv/config';
import { pool, transaction, audit } from '../../../packages/core/src/db.ts';
import { canSendReminder, localClock, nextReminderAt } from '../../../packages/core/src/policy.ts';
import { generateScheduledReport } from '../../../packages/core/src/reports.ts';
import { insertMessage } from '../../../packages/core/src/messages.ts';
import { OpenAIProvider } from '../../../packages/core/src/ai-provider.ts';
import { processClarification } from '../../../packages/core/src/clarification.ts';
import { claimEvents, finishEvent, failEvent, type EventRow } from '../../../packages/core/src/outbox.ts';

async function runAnalysis(event:EventRow) {
  if(event.kind!=='message.created') throw new Error('UNSUPPORTED_EVENT_KIND');
  if(!event.message_id) throw new Error('EVENT_MISSING_MESSAGE');
  const lookup=await pool.query(
    `SELECT m.kind,m.content,p.name,p.ai_enabled FROM messages m
     JOIN projects p ON p.id=m.project_id WHERE m.id=$1 AND m.project_id=$2`,
    [event.message_id,event.project_id],
  );
  const msg=lookup.rows[0] as {kind:string,content:string,name:string,ai_enabled:boolean}|undefined;
  if(!msg || msg.kind!=='user'||!msg.ai_enabled) return;
  if(await processClarification({id:event.message_id,projectId:event.project_id,
    content:msg.content,projectName:msg.name}))return;
  const existing=await pool.query(
    'SELECT 1 FROM proposed_changes WHERE project_id=$1 AND source_message_id=$2 LIMIT 1',
    [event.project_id,event.message_id]);
  if(existing.rowCount)return; // A retried event must not bill the model twice for stored proposals.
  const output=await new OpenAIProvider(event.project_id).extractCandidates(msg.name,msg.content);
  const suggestions=output.value;
  if(!suggestions.length)return;
  await transaction(async db=>{
    let added=0;
    const questions:string[]=[];
    for(const item of suggestions) {
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
    if(added) {
      const recent=await db.query(
        `SELECT 1 FROM messages WHERE project_id=$1 AND kind='ai'
         AND client_nonce LIKE 'analysis:%'
         AND created_at > NOW()-INTERVAL '10 minutes' LIMIT 1`,
        [event.project_id]);
      if(!recent.rowCount){
        const content='我从刚才的讨论中提取了 '+added+
          ' 项待确认的任务或风险，负责人可在「AI 待确认」中审核。'+
          (questions.length?'\n'+questions.slice(0,2).join('\n'):'');
        await insertMessage(db,{
          projectId:event.project_id,authorId:null,kind:'ai',
          content,nonce:'analysis:'+event.id,
        });
      }
      await audit(db,event.project_id,null,'ai.proposals_created',event.id,
        {sourceMessageId:event.message_id,count:added});
    }
  });
}

async function processEvents() {
  const events=await claimEvents();
  for(const event of events) {
    try {
      await runAnalysis(event);
      await finishEvent(event);
    }catch(err) {
      await failEvent(event,err);
      console.error('Outbox event failed',event.id,
        err instanceof Error?err.name:'UnknownFailure');
    }
  }
}

async function processReminders() {
  await transaction(async db=>{
    const {rows:plans}=await db.query(
      `SELECT fp.id,fp.project_id,fp.task_id,fp.task_version,
        t.title,t.status,t.version,t.due_at,t.assignee_id,
        u.display_name,p.timezone,p.work_start,p.work_end,p.cooldown_hours
       FROM followup_plans fp
       JOIN tasks t ON t.id=fp.task_id
       JOIN users u ON u.id=t.assignee_id
       JOIN projects p ON p.id=fp.project_id
       WHERE fp.active AND fp.next_at <= NOW()
       ORDER BY fp.next_at LIMIT 30 FOR UPDATE OF fp SKIP LOCKED`);
    for(const p of plans) {
      const current=p.status!=='done'&&p.status!=='cancelled'&&
        p.version===p.task_version&&p.assignee_id&&p.due_at;
      if(!current){
        await db.query('UPDATE followup_plans SET active=FALSE WHERE id=$1',[p.id]);
        continue;
      }
      const now=new Date();
      const eligible=canSendReminder(now,p);
      if(eligible) {
        const content='@'+p.display_name+'，任务「'+p.title+
          '」尚未标记完成。请确认当前进度、阻塞与预计完成时间。';
        const key='followup:'+p.task_id+':v'+p.version+':'+
          new Date().toISOString().slice(0,13);
        const inserted=await insertMessage(db,{
          projectId:p.project_id,authorId:null,kind:'ai',content,nonce:key,
        });
        if(inserted) {
          await db.query('UPDATE followup_plans SET last_sent_at=NOW() WHERE id=$1',[p.id]);
          await audit(db,p.project_id,null,'ai.followup_sent',p.task_id,
            {version:p.version,nonce:key});
        }
      }
      // Quiet time is not a sent reminder: resume at the next allowed instant.
      const earliest=eligible
        ? new Date(now.getTime() + (p.cooldown_hours ?? 24)*3600000)
        : new Date(now.getTime()+60000);
      await db.query('UPDATE followup_plans SET next_at=$2 WHERE id=$1',
        [p.id,nextReminderAt(earliest,p)]);
    }
  });
}
async function processReports() {
  // Keyset pagination avoids permanently starving projects beyond the first 1000.
  let cursor:string|null=null;
  while(true){
    const page:{rows:Array<{id:string;timezone:string}>}=await pool.query(
      `SELECT id,timezone FROM projects
       WHERE ($1::uuid IS NULL OR id > $1::uuid)
       ORDER BY id LIMIT 250`,[cursor]);
    if(!page.rows.length)break;
    for(const p of page.rows){
      const time=localClock(new Date(),p.timezone);
      if(time.hour!==9)continue;
      const dt=new Date(time.date+'T12:00:00Z');
      const weekly=dt.getUTCDay()===1;
      const monthly=dt.getUTCDate()===1;
      if(!weekly&&!monthly)continue;
      await transaction(async db=>{
        if(weekly)await generateScheduledReport(db,p.id,'week');
        if(monthly)await generateScheduledReport(db,p.id,'month');
      });
    }
    cursor=page.rows[page.rows.length-1].id;
  }
}

let busy=false;
let lastReportScanMinute=-1;
async function tick() {
  if(busy)return;
  busy=true;
  try {
    await processEvents();
    await processReminders();
    // One scan per minute per Worker, with DB locks guarding multiple replicas.
    const minute=Math.floor(Date.now()/60000);
    if(lastReportScanMinute!==minute){
      await processReports();
      lastReportScanMinute=minute;
    }
  }
  catch(e) { console.error('Worker tick failed',e instanceof Error?e.message:e); }
  finally {busy=false;}
}
console.log('ChatPM worker started: reliable outbox, reminders and report drafts.');
await tick();
setInterval(()=>void tick(),15000);
process.once('SIGTERM',()=>{void pool.end().then(()=>process.exit(0));});
process.once('SIGINT',()=>{void pool.end().then(()=>process.exit(0));});
