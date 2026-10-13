import type { DbClient } from './db.ts';
import { hasReminderPolicy, type WorkingPolicy } from './policy.ts';

export async function syncFollowup(db: DbClient, projectId: string, taskId: string) {
  const state = await db.query(
    `SELECT t.id,t.version,t.assignee_id,t.due_date::text AS due_date,t.status,p.timezone,p.work_start,p.work_end,p.cooldown_hours
     FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1 AND t.project_id=$2`,
    [taskId,projectId],
  );
  const row = state.rows[0] as (WorkingPolicy & {
    version:number; assignee_id:string|null; due_date:string|null; status:string
  }) | undefined;
  if (!row) throw new Error('Task not found');
  const active = Boolean(row.assignee_id && row.due_date && !['done','cancelled'].includes(row.status)
    && hasReminderPolicy(row));
  if (!active) {
    await db.query('UPDATE followup_plans SET active=FALSE WHERE task_id=$1', [taskId]);
    return;
  }
  // First status check is due soon after assignment, not a day before the deadline.
  const next = new Date(Date.now()+60_000);
  await db.query(
    `INSERT INTO followup_plans(project_id,task_id,task_version,next_at,active)
     VALUES($1,$2,$3,$4,TRUE)
     ON CONFLICT(task_id) DO UPDATE SET task_version=EXCLUDED.task_version,
     next_at=GREATEST(EXCLUDED.next_at,
       COALESCE(followup_plans.last_sent_at + ($5::integer * INTERVAL '1 hour'),
                EXCLUDED.next_at)),active=TRUE`,
    [projectId,taskId,row.version,next,row.cooldown_hours],
  );
}
