-- ADR-038. Evidence is an exact span of a single, project-scoped user message;
-- a claim is a proposed interpretation, not an accepted project fact.
CREATE TABLE project_evidence_spans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_message_id UUID NOT NULL,
  start_cp INTEGER NOT NULL CHECK(start_cp>=0),
  end_cp INTEGER NOT NULL CHECK(end_cp>start_cp AND end_cp-start_cp<=2000),
  quote TEXT NOT NULL CHECK(length(trim(quote)) BETWEEN 1 AND 2000),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,id),
  UNIQUE(project_id,source_message_id,start_cp,end_cp),
  FOREIGN KEY(project_id,source_message_id)
    REFERENCES messages(project_id,id)
);
CREATE INDEX idx_evidence_source ON project_evidence_spans(project_id,source_message_id);

CREATE TABLE project_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  evidence_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('work_progress','completion_claim','commitment',
    'blocker','risk_signal','issue_signal','decision_signal','change_signal','observation')),
  summary TEXT NOT NULL CHECK(length(trim(summary)) BETWEEN 1 AND 2000),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK(status IN ('pending','source_acknowledged','dismissed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by UUID NOT NULL REFERENCES users(id),
  reviewed_by UUID REFERENCES users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,id),
  FOREIGN KEY(project_id,evidence_id) REFERENCES project_evidence_spans(project_id,id),
  CHECK(status='pending' OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
CREATE INDEX idx_claims_project_recent ON project_claims(project_id,created_at DESC);
