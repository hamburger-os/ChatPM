-- Task archive is a reversible governance action, not a DELETE.
-- Archived rows, source proposals, dependencies and historical reports remain intact.
ALTER TABLE tasks
  ADD COLUMN archived_at TIMESTAMPTZ,
  ADD COLUMN archived_by UUID REFERENCES users(id),
  ADD CONSTRAINT ck_task_archive_pair CHECK (
    (archived_at IS NULL AND archived_by IS NULL) OR
    (archived_at IS NOT NULL AND archived_by IS NOT NULL)
  );
CREATE INDEX idx_tasks_active_project ON tasks(project_id,created_at DESC)
  WHERE archived_at IS NULL;
CREATE INDEX idx_tasks_archived_project ON tasks(project_id,archived_at DESC)
  WHERE archived_at IS NOT NULL;

-- Extend the existing single immutable Task history; never add a competing
-- archive event ledger. Pre-migration history is not fabricated.
ALTER TABLE project_task_history
  ADD COLUMN before_archived_at TIMESTAMPTZ,
  ADD COLUMN after_archived_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION capture_project_task_history() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  prior_status TEXT;
  prior_title TEXT;
  prior_due DATE;
  prior_assignee UUID;
  prior_archive TIMESTAMPTZ;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status AND
       OLD.title IS NOT DISTINCT FROM NEW.title AND
       OLD.due_date IS NOT DISTINCT FROM NEW.due_date AND
       OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id AND
       OLD.archived_at IS NOT DISTINCT FROM NEW.archived_at THEN
      RETURN NEW;
    END IF;
    prior_status := OLD.status;
    prior_title := OLD.title;
    prior_due := OLD.due_date;
    prior_assignee := OLD.assignee_id;
    prior_archive := OLD.archived_at;
  END IF;
  INSERT INTO project_task_history(project_id,task_id,task_version,kind,
    before_status,after_status,before_title,after_title,
    before_due_date,after_due_date,before_assignee_id,after_assignee_id,
    before_archived_at,after_archived_at)
  VALUES(NEW.project_id,NEW.id,NEW.version,
    CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,
    prior_status,NEW.status,prior_title,NEW.title,prior_due,NEW.due_date,
    prior_assignee,NEW.assignee_id,prior_archive,NEW.archived_at);
  RETURN NEW;
END
$$;

-- The archive command locks the Task before checking pending progress.
-- Every progress producer must take a conflicting lock before inserting.
-- This closes the race between a slow Worker and a concurrent archive.
CREATE FUNCTION reject_archived_task_progress() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  target_archived_at TIMESTAMPTZ;
BEGIN
  SELECT archived_at INTO target_archived_at FROM tasks
    WHERE project_id=NEW.project_id AND id=NEW.task_id FOR SHARE;
  IF target_archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'ARCHIVED_TASK_PROGRESS' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_reject_archived_task_progress
  BEFORE INSERT ON task_progress_updates
  FOR EACH ROW EXECUTE FUNCTION reject_archived_task_progress();
