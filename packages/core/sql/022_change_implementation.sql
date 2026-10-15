-- ADR-049: Change approval authorizes implementation, not its completion.
-- Historical approved/rejected changes keep null implementation evidence.
ALTER TABLE project_change_requests
  DROP CONSTRAINT project_change_requests_status_check;
ALTER TABLE project_change_requests
  ADD CONSTRAINT project_change_requests_status_check
  CHECK(status IN ('pending','approved','rejected','implementing','implemented'));
ALTER TABLE project_change_requests
  ADD COLUMN implementation_owner_id UUID REFERENCES users(id),
  ADD COLUMN implementation_started_at TIMESTAMPTZ,
  ADD COLUMN implementation_evidence_message_id UUID,
  ADD COLUMN implemented_by UUID REFERENCES users(id),
  ADD COLUMN implemented_at TIMESTAMPTZ,
  ADD CONSTRAINT change_implementation_started
    CHECK(status NOT IN ('implementing','implemented') OR
      (implementation_owner_id IS NOT NULL AND implementation_started_at IS NOT NULL)),
  ADD CONSTRAINT change_implementation_verified
    CHECK(status<>'implemented' OR
      (implemented_by IS NOT NULL AND implemented_at IS NOT NULL
        AND implementation_evidence_message_id IS NOT NULL)),
  ADD CONSTRAINT change_implementation_evidence_scope
    FOREIGN KEY(project_id,implementation_evidence_message_id)
    REFERENCES messages(project_id,id);

CREATE TABLE project_change_implementation_history(
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  change_id UUID NOT NULL,
  change_version INTEGER NOT NULL CHECK(change_version>2),
  action TEXT NOT NULL CHECK(action IN ('start','reassign','complete')),
  from_status TEXT NOT NULL CHECK(from_status IN ('approved','implementing')),
  to_status TEXT NOT NULL CHECK(to_status IN ('implementing','implemented')),
  note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 2000),
  actor_id UUID NOT NULL REFERENCES users(id),
  evidence_message_id UUID,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,change_id,change_version),
  FOREIGN KEY(project_id,change_id)
    REFERENCES project_change_requests(project_id,id) ON DELETE CASCADE,
  FOREIGN KEY(project_id,evidence_message_id)
    REFERENCES messages(project_id,id),
  CHECK((action='start' AND from_status='approved' AND to_status='implementing'
    AND evidence_message_id IS NULL) OR
    (action='complete' AND from_status='implementing' AND to_status='implemented'
    AND evidence_message_id IS NOT NULL) OR
    (action='reassign' AND from_status='implementing' AND to_status='implementing'
    AND evidence_message_id IS NULL))
);
CREATE INDEX idx_change_implementation_history_recent
  ON project_change_implementation_history(project_id,change_id,change_version DESC);
