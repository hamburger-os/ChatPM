-- ADR-089: one authoritative database for IM account, verified binding, event receipt.
CREATE TABLE im_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK(channel='wecom'),
  external_bot_id TEXT NOT NULL UNIQUE CHECK(length(trim(external_bot_id)) BETWEEN 1 AND 200),
  secret_ciphertext TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id,id)
);
CREATE TABLE im_binding_challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  account_id UUID NOT NULL,
  actor_id UUID NOT NULL,
  project_id UUID,
  purpose TEXT NOT NULL CHECK(purpose IN ('user','room')),
  code_hash TEXT NOT NULL UNIQUE CHECK(length(code_hash)=64),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK((purpose='user' AND project_id IS NULL) OR (purpose='room' AND project_id IS NOT NULL)),
  FOREIGN KEY(tenant_id,account_id) REFERENCES im_accounts(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,actor_id) REFERENCES tenant_members(tenant_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX im_challenges_pending ON im_binding_challenges(account_id,expires_at)
  WHERE consumed_at IS NULL;
CREATE TABLE im_user_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  account_id UUID NOT NULL,
  user_id UUID NOT NULL,
  external_user_id TEXT NOT NULL CHECK(length(trim(external_user_id)) BETWEEN 1 AND 200),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY(tenant_id,account_id) REFERENCES im_accounts(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,user_id) REFERENCES tenant_members(tenant_id,user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX im_unique_active_external_user ON im_user_bindings(account_id,external_user_id) WHERE active;
CREATE UNIQUE INDEX im_unique_active_user ON im_user_bindings(account_id,user_id) WHERE active;
CREATE TABLE im_room_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  account_id UUID NOT NULL,
  project_id UUID NOT NULL,
  external_chat_id TEXT NOT NULL CHECK(length(trim(external_chat_id)) BETWEEN 1 AND 200),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  FOREIGN KEY(tenant_id,account_id) REFERENCES im_accounts(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX im_unique_active_room ON im_room_bindings(account_id,external_chat_id) WHERE active;
CREATE UNIQUE INDEX im_unique_active_project_room ON im_room_bindings(project_id,account_id) WHERE active;
CREATE TABLE im_inbox (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  account_id UUID NOT NULL,
  external_message_id TEXT NOT NULL CHECK(length(trim(external_message_id)) BETWEEN 1 AND 200),
  external_user_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  message_id UUID NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id,external_message_id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES im_accounts(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,user_id) REFERENCES tenant_members(tenant_id,user_id) ON DELETE CASCADE,
  FOREIGN KEY(project_id,message_id) REFERENCES messages(project_id,id) ON DELETE CASCADE
);
CREATE INDEX im_inbox_project_time ON im_inbox(project_id,received_at);
