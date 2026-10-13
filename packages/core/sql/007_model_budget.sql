-- Provider capabilities are not the per-request task budget. Increase configurable ceilings,
-- but do not default to the provider's maximum 384K-token output.
ALTER TABLE projects DROP CONSTRAINT projects_model_reasoning_check;
ALTER TABLE projects ADD CONSTRAINT projects_model_reasoning_check CHECK (
  model_reasoning IN ('auto','none','low','medium','high','max'));
ALTER TABLE projects DROP CONSTRAINT projects_model_max_output_tokens_check;
ALTER TABLE projects ADD CONSTRAINT projects_model_max_output_tokens_check
  CHECK (model_max_output_tokens BETWEEN 512 AND 131072);
ALTER TABLE projects DROP CONSTRAINT projects_model_context_chars_check;
ALTER TABLE projects ADD CONSTRAINT projects_model_context_chars_check
  CHECK (model_context_chars BETWEEN 2000 AND 250000);
ALTER TABLE projects ALTER COLUMN model_max_output_tokens SET DEFAULT 8192;
ALTER TABLE projects ALTER COLUMN model_context_chars SET DEFAULT 32768;
UPDATE projects SET model_context_chars=32768 WHERE model_context_chars=6500;
UPDATE projects SET model_max_output_tokens=8192 WHERE model_max_output_tokens=2048;
