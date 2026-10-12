import type { DbClient } from './db.ts';
import { hasReminderPolicy, type WorkingPolicy } from './policy.ts';

export async function syncFollowup(db: DbClient, projectId: string, taskId: string) {
  const state = await db.query(
    `SELECT t.id,t.version,t.assignee_id,t.due_at,t.status,p.timezone,p.work_start,p.work_end,p.cooldown_hours
     FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=$1 AND t.project_id=$2`,
    [taskId,projectId],
  );
  const row = state.rows[0] as (WorkingPolicy & {
    version:number; assignee_id:string|null; due_at:Date|null; status:string
  }) | undefined;
  if (!row) throw new Error('Task not found');
  const active = Boolean(row.assignee_id && row.due_at && !['done','cancelled'].includes(row.status)
    && hasReminderPolicy(row));
  if (!active) {
    await db.query('UPDATE followup_plans SET active=FALSE WHERE task_id=$1', [taskId]);
    return;
  }
  const due = new Date(row.due_at!);
  const next = new Date(Math.max(Date.now()+60000, due.getTime()-86400000));
  await db.query(
    `INSERT INTO followup_plans(project_id,task_id,task_version,next_at,active)
     VALUES($1,$2,$3,$4,TRUE)
     ON CONFLICT(task_id) DO UPDATE SET task_version=EXCLUDED.task_version,
     next_at=EXCLUDED.next_at,active=TRUE`,
    [projectId,taskId,row.version,next],
  );
}
