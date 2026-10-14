import { transaction, audit } from '../db.ts';
import { canSendReminder, localClock, nextReminderAt, followupIntervalDays } from '../policy.ts';
import { insertMessage } from '../messages.ts';
import { reminderCopy } from './reminder-copy.ts';

export async function processReminders() {
  await transaction(async db=>{
    const {rows:plans}=await db.query(
      `SELECT fp.id,fp.project_id,fp.task_id,fp.task_version,
        t.title,t.status,t.version,t.due_date::text AS due_date,t.assignee_id,
        last_progress.kind AS latest_progress_kind,
        u.display_name,p.timezone,p.work_start,p.work_end,p.cooldown_hours
       FROM followup_plans fp
       JOIN tasks t ON t.id=fp.task_id
       JOIN users u ON u.id=t.assignee_id
       JOIN projects p ON p.id=fp.project_id
       LEFT JOIN LATERAL (
         SELECT kind FROM task_progress_updates x WHERE x.project_id=fp.project_id
           AND x.task_id=t.id AND x.status='accepted'
         ORDER BY x.reviewed_at DESC LIMIT 1
       ) last_progress ON TRUE
       WHERE fp.active AND fp.next_at <= NOW()
       ORDER BY fp.next_at LIMIT 30 FOR UPDATE OF fp SKIP LOCKED`);
    for(const p of plans) {
      const current=p.status!=='done'&&p.status!=='cancelled'&&
        p.version===p.task_version&&p.assignee_id&&p.due_date;
      if(!current){
        await db.query('UPDATE followup_plans SET active=FALSE WHERE id=$1',[p.id]);
        continue;
      }
      const now=new Date();
      const eligible=canSendReminder(now,p);
      if(eligible) {
        const remaining=Math.round((Date.parse(p.due_date+'T12:00:00Z')-
          Date.parse(localClock(now,p.timezone).date+'T12:00:00Z'))/86400000);
        const content=reminderCopy({
          displayName:p.display_name,title:p.title,daysUntilDue:remaining,
          blocked:p.status==='blocked'||p.latest_progress_kind==='blocker',
        });
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
        ? new Date(now.getTime() + Math.max(p.cooldown_hours??24,
            followupIntervalDays(p.due_date,localClock(now,p.timezone).date,
              p.latest_progress_kind==='blocker'?'blocked':p.status)*24)*3600000)
        : new Date(now.getTime()+60000);
      await db.query('UPDATE followup_plans SET next_at=$2 WHERE id=$1',
        [p.id,nextReminderAt(earliest,p)]);
    }
  });
}
