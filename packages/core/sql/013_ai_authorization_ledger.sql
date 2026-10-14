-- ADR-032. One authoritative AI enable flag, with a version increment
-- whenever it changes (including changes outside the primary HTTP entry).
ALTER TABLE projects ADD COLUMN ai_authorization_version BIGINT NOT NULL DEFAULT 1
  CHECK(ai_authorization_version>0);
CREATE FUNCTION advance_project_ai_authorization() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.ai_enabled IS DISTINCT FROM OLD.ai_enabled THEN
    NEW.ai_authorization_version := OLD.ai_authorization_version + 1;
  ELSE
    NEW.ai_authorization_version := OLD.ai_authorization_version;
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER trg_advance_project_ai_authorization
  BEFORE UPDATE OF ai_enabled ON projects FOR EACH ROW
  EXECUTE FUNCTION advance_project_ai_authorization();

-- This is a log of actual model-call attempts, NOT a copy of conversation
-- contents, parsed model output, or a synthetic statement of token costs.
CREATE TABLE ai_model_invocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  authorization_version BIGINT NOT NULL CHECK(authorization_version>0),
  model_identity TEXT NOT NULL CHECK(length(model_identity) BETWEEN 1 AND 500),
  prompt_version TEXT NOT NULL CHECK(length(prompt_version) BETWEEN 1 AND 100),
  input_fingerprint CHAR(64) NOT NULL,
  status TEXT NOT NULL DEFAULT 'processing'
    CHECK(status IN ('processing','succeeded','failed')),
  error_code TEXT,
  latency_ms INTEGER CHECK(latency_ms>=0),
  input_tokens BIGINT CHECK(input_tokens>=0),
  output_tokens BIGINT CHECK(output_tokens>=0),
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  CHECK(
    (status='processing' AND finished_at IS NULL)
    OR (status<>'processing' AND finished_at IS NOT NULL)
  )
);
CREATE INDEX idx_ai_invocations_project_started
  ON ai_model_invocations(project_id,started_at DESC);
