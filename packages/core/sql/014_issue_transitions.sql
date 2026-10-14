-- ADR-036. Immutable, project-scoped issue resolution/reopening history.
-- Preserve previously-created issues without changing the original baseline.
CREATE TABLE project_issue_transitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  issue_id UUID NOT NULL,
  from_status TEXT NOT NULL CHECK(from_status IN ('open','resolved')),
  to_status TEXT NOT NULL CHECK(to_status IN ('open','resolved')),
  issue_version INTEGER NOT NULL CHECK(issue_version>1),
  note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 2000),
  actor_id UUID NOT NULL REFERENCES users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(from_status<>to_status),
  UNIQUE(project_id,issue_id,issue_version),
  FOREIGN KEY(project_id,issue_id)
    REFERENCES project_issues(project_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_issue_history_recent ON project_issue_transitions(
  project_id,issue_id,issue_version DESC);
