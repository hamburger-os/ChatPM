-- ADR-026: rate-limit model directory discovery across API processes.
CREATE TABLE ai_provider_checks (
  provider_id UUID PRIMARY KEY REFERENCES ai_provider_connections(id) ON DELETE CASCADE,
  last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
