-- ADR-056: record factual task transitions at the database boundary.
-- This covers direct Task commands, accepted AI proposals and subsequent write paths.
-- Historical periods before this migration have no synthesized transition rows.
CREATE TABLE project_task_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  task_id UUID NOT NULL,
  task_version INTEGER NOT NULL CHECK(task_version > 0),
  kind TEXT NOT NULL CHECK(kind IN ('created','updated')),
  before_status TEXT,
  after_status TEXT NOT NULL,
  before_title TEXT,
  after_title TEXT NOT NULL,
  before_due_date DATE,
  after_due_date DATE,
  before_assignee_id UUID,
  after_assignee_id UUID,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_task_history_project_time
  ON project_task_history(project_id,changed_at DESC,id DESC);

CREATE FUNCTION capture_project_task_history() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  prior_status TEXT;
  prior_title TEXT;
  prior_due DATE;
  prior_assignee UUID;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.status IS NOT DISTINCT FROM NEW.status AND
       OLD.title IS NOT DISTINCT FROM NEW.title AND
       OLD.due_date IS NOT DISTINCT FROM NEW.due_date AND
       OLD.assignee_id IS NOT DISTINCT FROM NEW.assignee_id THEN
      RETURN NEW;
    END IF;
    prior_status := OLD.status;
    prior_title := OLD.title;
    prior_due := OLD.due_date;
    prior_assignee := OLD.assignee_id;
  END IF;
  INSERT INTO project_task_history(project_id,task_id,task_version,kind,
    before_status,after_status,before_title,after_title,
    before_due_date,after_due_date,before_assignee_id,after_assignee_id)
  VALUES(NEW.project_id,NEW.id,NEW.version,
    CASE WHEN TG_OP='INSERT' THEN 'created' ELSE 'updated' END,
    prior_status,NEW.status,
    prior_title,NEW.title,
    prior_due,NEW.due_date,
    prior_assignee,NEW.assignee_id);
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_capture_project_task_history
  AFTER INSERT OR UPDATE ON tasks
  FOR EACH ROW EXECUTE FUNCTION capture_project_task_history();

-- Ordinary application commands cannot rewrite prior task transitions.
CREATE FUNCTION reject_task_history_update() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'TASK_HISTORY_IMMUTABLE' USING ERRCODE='23514';
END
$$;
CREATE TRIGGER trg_reject_task_history_update
  BEFORE UPDATE ON project_task_history
  FOR EACH ROW EXECUTE FUNCTION reject_task_history_update();
