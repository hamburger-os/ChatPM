-- ADR-046: Risk is a prospective uncertainty; keep legacy risk identities,
-- approved-AI proposal links and existing actual statuses (open/resolved).
ALTER TABLE risks ADD COLUMN version INTEGER NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE risks ADD COLUMN likelihood SMALLINT CHECK(likelihood BETWEEN 1 AND 5);
ALTER TABLE risks ADD COLUMN impact SMALLINT CHECK(impact BETWEEN 1 AND 5);
ALTER TABLE risks ADD COLUMN owner_id UUID REFERENCES users(id);
ALTER TABLE risks ADD COLUMN response_plan TEXT NOT NULL DEFAULT ''
  CHECK(length(response_plan)<=5000);
ALTER TABLE risks ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE risks ADD CONSTRAINT risk_assessment_pair
  CHECK ((likelihood IS NULL) = (impact IS NULL));
ALTER TABLE risks DROP CONSTRAINT risks_status_check;
ALTER TABLE risks ADD CONSTRAINT risks_status_check
  CHECK(status IN ('open','mitigating','resolved'));
ALTER TABLE risks ADD CONSTRAINT uq_risks_project_id UNIQUE(project_id,id);

CREATE TABLE risk_register_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL,
  risk_id UUID NOT NULL,
  risk_version INTEGER NOT NULL CHECK(risk_version>1),
  action TEXT NOT NULL CHECK(action IN ('assessment','transition')),
  from_status TEXT NOT NULL CHECK(from_status IN ('open','mitigating','resolved')),
  to_status TEXT NOT NULL CHECK(to_status IN ('open','mitigating','resolved')),
  note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 2000),
  actor_id UUID NOT NULL REFERENCES users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,risk_id,risk_version),
  FOREIGN KEY(project_id,risk_id) REFERENCES risks(project_id,id) ON DELETE CASCADE,
  CHECK((action='assessment' AND from_status=to_status)
     OR (action='transition' AND from_status<>to_status))
);
CREATE INDEX idx_risk_change_recent ON risk_register_changes(
  project_id,risk_id,risk_version DESC);
