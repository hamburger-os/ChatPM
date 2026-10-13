-- One-time business-date migration: convert each deadline using its project's IANA timezone.
-- No legacy due_at API is retained; original instants remain in audit history.
ALTER TABLE tasks ADD COLUMN due_date DATE;
UPDATE tasks t SET due_date=(t.due_at AT TIME ZONE p.timezone)::date
  FROM projects p WHERE t.project_id=p.id AND t.due_at IS NOT NULL;
ALTER TABLE tasks DROP COLUMN due_at;
CREATE INDEX idx_tasks_due_date ON tasks(project_id,due_date)
  WHERE due_date IS NOT NULL AND status NOT IN ('done','cancelled');

CREATE TABLE task_progress_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  task_id UUID NOT NULL,
  source_message_id UUID NOT NULL,
  summary TEXT NOT NULL CHECK(length(summary) BETWEEN 1 AND 2000),
  kind TEXT NOT NULL CHECK(kind IN ('progress','blocker','completion_claim')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','rejected')),
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id),
  FOREIGN KEY(project_id,source_message_id) REFERENCES messages(project_id,id),
  UNIQUE(project_id,task_id,source_message_id)
);
CREATE INDEX idx_task_progress_pending ON task_progress_updates(project_id,status,created_at DESC);
CREATE INDEX idx_task_progress_task ON task_progress_updates(project_id,task_id,created_at DESC);

-- Re-enroll existing active plans into the new early-check policy on upgrade.
-- Do not bypass the cooldown from an already delivered reminder.
UPDATE followup_plans fp SET next_at=GREATEST(
  LEAST(fp.next_at,NOW()+INTERVAL '2 minutes'),
  COALESCE(fp.last_sent_at+(p.cooldown_hours*INTERVAL '1 hour'),NOW()))
  FROM projects p WHERE p.id=fp.project_id AND fp.active
    AND p.cooldown_hours IS NOT NULL;
