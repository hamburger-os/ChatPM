-- ADR-059: one-time organization invitations. Only token digests are durable.
CREATE TABLE tenant_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email TEXT NOT NULL CHECK(length(email) BETWEEN 3 AND 200 AND email=lower(email)),
  token_sha256 CHAR(64) NOT NULL UNIQUE CHECK(token_sha256 ~ '^[a-f0-9]{64}$'),
  invited_by UUID NOT NULL REFERENCES users(id),
  accepted_by UUID REFERENCES users(id),
  revoked_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CONSTRAINT ck_invitation_expiry CHECK(expires_at>created_at),
  CONSTRAINT ck_invitation_acceptance CHECK((accepted_at IS NULL)=(accepted_by IS NULL)),
  CONSTRAINT ck_invitation_revocation CHECK((revoked_at IS NULL)=(revoked_by IS NULL)),
  CONSTRAINT ck_invitation_exclusive CHECK(accepted_at IS NULL OR revoked_at IS NULL),
  UNIQUE(tenant_id,id)
);
CREATE INDEX idx_tenant_invitations_tenant_email
  ON tenant_invitations(tenant_id,email,created_at DESC);
CREATE INDEX idx_tenant_invitations_open
  ON tenant_invitations(tenant_id,expires_at)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
