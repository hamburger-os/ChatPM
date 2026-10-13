-- Project-scoped AI model credentials and observable analysis attempts.
-- Endpoints for UI-configured providers are fixed in code to prevent SSRF.
ALTER TABLE projects
  ADD COLUMN model_provider TEXT NOT NULL DEFAULT 'server'
    CHECK(model_provider IN ('server','openai','deepseek')),
  ADD COLUMN model_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN model_api_style TEXT NOT NULL DEFAULT 'responses'
    CHECK(model_api_style IN ('responses','chat-completions')),
  ADD COLUMN model_key_ciphertext TEXT,
  ADD COLUMN model_reasoning TEXT NOT NULL DEFAULT 'auto'
    CHECK(model_reasoning IN ('auto','low','medium','high')),
  ADD COLUMN model_max_output_tokens INTEGER NOT NULL DEFAULT 2048
    CHECK(model_max_output_tokens BETWEEN 512 AND 8192),
  ADD COLUMN model_context_chars INTEGER NOT NULL DEFAULT 6500
    CHECK(model_context_chars BETWEEN 2000 AND 16000);
CREATE TABLE ai_analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_message_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('extract','clarify','reply')),
  status TEXT NOT NULL CHECK(status IN ('processing','no_change','proposal','clarified','replied','failed')),
  model_name TEXT,
  error_code TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,source_message_id),
  FOREIGN KEY(project_id,source_message_id) REFERENCES messages(project_id,id)
);
CREATE INDEX idx_analysis_project ON ai_analysis_runs(project_id,created_at DESC);
