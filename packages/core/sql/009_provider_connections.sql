-- ADR-024: a reusable provider connection owns credentials and wire protocol.
CREATE TABLE ai_provider_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 100),
  base_url TEXT NOT NULL CHECK(length(base_url) BETWEEN 8 AND 2048),
  api_style TEXT NOT NULL CHECK(api_style IN ('responses','chat-completions')),
  api_key_ciphertext TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(NOT enabled OR api_key_ciphertext IS NOT NULL)
);
-- Lossless one-time relocation of existing credentials, one provider per old
-- model. Admins may consolidate provider connections in the new interface.
INSERT INTO ai_provider_connections(id,name,base_url,api_style,api_key_ciphertext,enabled)
 SELECT id,'连接 - '||name,base_url,api_style,api_key_ciphertext,
        api_key_ciphertext IS NOT NULL
 FROM ai_model_configs;
ALTER TABLE ai_model_configs
  ADD COLUMN provider_id UUID REFERENCES ai_provider_connections(id) ON DELETE RESTRICT;
UPDATE ai_model_configs SET provider_id=id;
ALTER TABLE ai_model_configs ALTER COLUMN provider_id SET NOT NULL;
ALTER TABLE ai_model_configs
  ADD COLUMN reasoning_format TEXT NOT NULL DEFAULT 'none'
    CHECK(reasoning_format IN ('none','responses-effort','chat-completions-effort'));
ALTER TABLE ai_model_configs
  DROP COLUMN base_url CASCADE,
  DROP COLUMN api_style CASCADE,
  DROP COLUMN api_key_ciphertext CASCADE;
CREATE INDEX idx_ai_models_provider ON ai_model_configs(provider_id);
