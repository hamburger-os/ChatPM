-- Formal PM register and idempotent scoped command/event base.
-- Existing Task, Risk and chat data remain untouched. All cross-aggregate
-- references include project_id to prevent cross-project association.
CREATE TABLE project_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 250),
  description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=5000),
  success_criteria TEXT NOT NULL CHECK(length(trim(success_criteria)) BETWEEN 1 AND 3000),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,id)
);
CREATE TABLE project_milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  goal_id UUID,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 250),
  due_date DATE NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,id),
  FOREIGN KEY(project_id,goal_id) REFERENCES project_goals(project_id,id)
);
CREATE TABLE project_deliverables (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  milestone_id UUID,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 250),
  acceptance_criteria TEXT NOT NULL CHECK(length(trim(acceptance_criteria)) BETWEEN 1 AND 3000),
  assignee_id UUID NOT NULL,
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'planned'
    CHECK(status IN ('planned','submitted','accepted','returned')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  submitted_by UUID REFERENCES users(id),
  reviewed_by UUID REFERENCES users(id),
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,id),
  FOREIGN KEY(project_id,milestone_id) REFERENCES project_milestones(project_id,id),
  FOREIGN KEY(project_id,assignee_id) REFERENCES project_members(project_id,user_id),
  CHECK(status <> 'accepted' OR
    (submitted_by IS NOT NULL AND reviewed_by IS NOT NULL AND
     submitted_by <> reviewed_by AND reviewed_at IS NOT NULL))
);
CREATE TABLE project_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 250),
  detail TEXT NOT NULL DEFAULT '' CHECK(length(detail)<=5000),
  severity TEXT NOT NULL CHECK(severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
  owner_id UUID,
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,id),
  FOREIGN KEY(project_id,owner_id) REFERENCES project_members(project_id,user_id)
);
CREATE TABLE project_decisions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 250),
  rationale TEXT NOT NULL CHECK(length(trim(rationale)) BETWEEN 1 AND 5000),
  decided_by UUID NOT NULL REFERENCES users(id),
  decided_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,id)
);
CREATE TABLE project_change_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK(length(trim(title)) BETWEEN 1 AND 250),
  rationale TEXT NOT NULL CHECK(length(trim(rationale)) BETWEEN 1 AND 5000),
  impact TEXT NOT NULL CHECK(length(trim(impact)) BETWEEN 1 AND 5000),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  created_by UUID NOT NULL REFERENCES users(id),
  decided_by UUID REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,id),
  CHECK(status='pending' OR (decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE TABLE task_dependencies (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  dependent_task_id UUID NOT NULL,
  prerequisite_task_id UUID NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(project_id,dependent_task_id,prerequisite_task_id),
  FOREIGN KEY(project_id,dependent_task_id) REFERENCES tasks(project_id,id) ON DELETE CASCADE,
  FOREIGN KEY(project_id,prerequisite_task_id) REFERENCES tasks(project_id,id) ON DELETE CASCADE,
  CHECK(dependent_task_id<>prerequisite_task_id)
);
CREATE INDEX idx_task_dependency_prerequisite ON task_dependencies(project_id,prerequisite_task_id);
CREATE TABLE command_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  actor_id UUID NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK(length(kind) BETWEEN 1 AND 100),
  idempotency_key UUID NOT NULL,
  payload_hash TEXT NOT NULL CHECK(length(payload_hash)=64),
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,actor_id,kind,idempotency_key),
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE CASCADE
);
CREATE TABLE domain_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  project_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK(length(kind) BETWEEN 1 AND 100),
  aggregate_type TEXT NOT NULL,
  aggregate_id UUID NOT NULL,
  aggregate_version INTEGER NOT NULL CHECK(aggregate_version>0),
  command_receipt_id UUID NOT NULL UNIQUE REFERENCES command_receipts(id),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(project_id,id),
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX idx_domain_events_project_created ON domain_events(project_id,created_at DESC);
