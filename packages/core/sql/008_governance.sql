-- Organization governance and platform-controlled AI model configuration.
ALTER TABLE users ADD COLUMN is_system_admin BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE projects ADD CONSTRAINT uq_projects_tenant_id UNIQUE(tenant_id,id);
ALTER TABLE project_members DROP CONSTRAINT project_members_role_check;
ALTER TABLE project_members ADD CONSTRAINT project_members_role_check
  CHECK(role IN ('owner','manager','member','observer'));

CREATE TABLE departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 140),
  parent_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,id),
  UNIQUE(tenant_id,name),
  FOREIGN KEY(tenant_id,parent_id) REFERENCES departments(tenant_id,id),
  CHECK(id IS DISTINCT FROM parent_id)
);
CREATE TABLE department_members (
  tenant_id UUID NOT NULL,
  department_id UUID NOT NULL,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('lead','member')),
  PRIMARY KEY(department_id,user_id),
  FOREIGN KEY(tenant_id,department_id) REFERENCES departments(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,user_id) REFERENCES tenant_members(tenant_id,user_id) ON DELETE CASCADE
);
CREATE TABLE portfolios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 140),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,id)
);
CREATE TABLE programs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  portfolio_id UUID,
  name TEXT NOT NULL CHECK(length(trim(name)) BETWEEN 1 AND 140),
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(tenant_id,id),
  FOREIGN KEY(tenant_id,portfolio_id) REFERENCES portfolios(tenant_id,id)
);
ALTER TABLE projects
  ADD COLUMN department_id UUID,
  ADD COLUMN program_id UUID,
  ADD COLUMN portfolio_id UUID,
  ADD CONSTRAINT fk_projects_department FOREIGN KEY(tenant_id,department_id) REFERENCES departments(tenant_id,id),
  ADD CONSTRAINT fk_projects_program FOREIGN KEY(tenant_id,program_id) REFERENCES programs(tenant_id,id),
  ADD CONSTRAINT fk_projects_portfolio FOREIGN KEY(tenant_id,portfolio_id) REFERENCES portfolios(tenant_id,id),
  ADD CONSTRAINT ck_project_single_portfolio_source CHECK(program_id IS NULL OR portfolio_id IS NULL);
CREATE TABLE project_departments (
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  department_id UUID NOT NULL,
  PRIMARY KEY(project_id,department_id),
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,department_id) REFERENCES departments(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE resource_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  percentage INTEGER NOT NULL CHECK(percentage BETWEEN 1 AND 100),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  CHECK(start_date<=end_date),
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,user_id) REFERENCES tenant_members(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX idx_allocations_user_dates ON resource_allocations(tenant_id,user_id,start_date,end_date);
CREATE INDEX idx_programs_portfolio ON programs(tenant_id,portfolio_id);
CREATE INDEX idx_projects_program ON projects(tenant_id,program_id);

-- The old project-scoped provider secrets were an experimental design; remove
-- them instead of maintaining two conflicting sources of truth.
DROP TABLE ai_model_checks;
ALTER TABLE projects
 DROP COLUMN model_provider, DROP COLUMN model_id, DROP COLUMN model_api_style,
 DROP COLUMN model_key_ciphertext, DROP COLUMN model_reasoning,
 DROP COLUMN model_max_output_tokens, DROP COLUMN model_context_chars;
CREATE TABLE ai_model_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE CHECK(length(trim(name)) BETWEEN 1 AND 100),
  model_id TEXT NOT NULL CHECK(length(trim(model_id)) BETWEEN 1 AND 150),
  base_url TEXT NOT NULL CHECK(length(base_url) BETWEEN 8 AND 2048),
  api_style TEXT NOT NULL CHECK(api_style IN ('responses','chat-completions')),
  api_key_ciphertext TEXT,
  reasoning TEXT NOT NULL DEFAULT 'auto' CHECK(reasoning IN ('auto','none','low','medium','high','max')),
  max_output_tokens INTEGER NOT NULL DEFAULT 8192 CHECK(max_output_tokens BETWEEN 512 AND 131072),
  context_chars INTEGER NOT NULL DEFAULT 32768 CHECK(context_chars BETWEEN 2000 AND 250000),
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK(NOT is_default OR enabled),
  CHECK(NOT enabled OR api_key_ciphertext IS NOT NULL)
);
CREATE UNIQUE INDEX uq_active_default_model ON ai_model_configs(is_default) WHERE is_default;
CREATE TABLE ai_model_checks (
  model_config_id UUID PRIMARY KEY REFERENCES ai_model_configs(id) ON DELETE CASCADE,
  last_test_at TIMESTAMPTZ NOT NULL
);

-- Organization and platform operations need an audit trail even without a project.
CREATE TABLE organization_audit_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_organization_audit_tenant ON organization_audit_entries(tenant_id,created_at DESC);
CREATE TABLE system_audit_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  target_id UUID,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
