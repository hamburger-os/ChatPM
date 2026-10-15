-- ADR-048: Tenant-scope receipt for a command whose target Project does not exist yet.
-- Different from project-scoped command_receipts; no synthetic project ID is used.
CREATE TABLE tenant_command_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(length(kind) BETWEEN 1 AND 100),
  idempotency_key UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  project_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,actor_id,kind,idempotency_key)
);
