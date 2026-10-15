-- ADR-047: One owner role for each project and an independent
-- optimistic revision for project responsibility transfers.
ALTER TABLE projects ADD COLUMN ownership_revision INTEGER NOT NULL DEFAULT 1
  CHECK (ownership_revision>0);
CREATE UNIQUE INDEX uq_one_owner_per_project ON project_members(project_id)
  WHERE role='owner';
