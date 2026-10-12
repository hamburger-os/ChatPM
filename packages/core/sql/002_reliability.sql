-- Versioned, additive reliability and AI evidence schema.
ALTER TABLE outbox_events
  ADD COLUMN next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN dead_at TIMESTAMPTZ,
  ADD COLUMN claim_token UUID,
  ADD COLUMN last_error_code TEXT;
CREATE INDEX idx_outbox_due ON outbox_events(next_attempt_at,created_at)
  WHERE processed_at IS NULL AND dead_at IS NULL;
CREATE INDEX idx_outbox_project_created ON outbox_events(project_id,created_at);
CREATE INDEX idx_outbox_dead ON outbox_events(project_id,dead_at DESC)
  WHERE dead_at IS NOT NULL;

ALTER TABLE proposed_changes
  ADD COLUMN model_name TEXT NOT NULL DEFAULT 'unrecorded',
  ADD COLUMN prompt_version TEXT NOT NULL DEFAULT 'v1',
  ADD COLUMN evidence_text TEXT NOT NULL DEFAULT '';

CREATE TABLE clarification_threads (
  proposal_id UUID PRIMARY KEY REFERENCES proposed_changes(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered','closed')),
  response_message_id UUID REFERENCES messages(id),
  assignee_hint TEXT,
  due_at TIMESTAMPTZ,
  confidence NUMERIC(4,3),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE clarification_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  proposal_id UUID NOT NULL REFERENCES proposed_changes(id) ON DELETE CASCADE,
  message_id UUID NOT NULL REFERENCES messages(id),
  model_name TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  assignee_hint TEXT,
  due_at TIMESTAMPTZ,
  confidence NUMERIC(4,3) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(proposal_id,message_id)
);
CREATE INDEX idx_clarification_project ON clarification_threads(project_id,status,updated_at DESC);

CREATE TABLE ai_daily_usage (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  usage_day DATE NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0 CHECK(requests>=0),
  PRIMARY KEY(project_id,usage_day)
);
