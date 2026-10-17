-- ADR-078: project_members(role='owner') is the ONLY persisted owner identity.
-- Reject legacy inconsistencies; never silently reassign responsibility.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM projects p
    LEFT JOIN project_members pm
      ON pm.project_id=p.id AND pm.role='owner'
    WHERE pm.user_id IS DISTINCT FROM p.owner_id
  ) THEN
    RAISE EXCEPTION 'PROJECT_OWNER_MIGRATION_REQUIRES_RECONCILIATION'
      USING ERRCODE='23514';
  END IF;
END $$;

ALTER TABLE projects DROP COLUMN owner_id;

-- Existing uq_one_owner_per_project enforces <=1. Deferred triggers enforce
-- >=1 at COMMIT, allowing atomic project creation and owner handoff.
CREATE FUNCTION assert_project_has_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  project_to_check UUID;
BEGIN
  IF TG_TABLE_NAME='projects' THEN
    project_to_check:=NEW.id;
  ELSIF TG_OP='DELETE' THEN
    project_to_check:=OLD.project_id;
  ELSE
    project_to_check:=NEW.project_id;
  END IF;
  IF EXISTS(SELECT 1 FROM projects WHERE id=project_to_check)
    AND NOT EXISTS(
      SELECT 1 FROM project_members
      WHERE project_id=project_to_check AND role='owner'
    ) THEN
    RAISE EXCEPTION 'PROJECT_OWNER_REQUIRED for project %',project_to_check
      USING ERRCODE='23514';
  END IF;

  -- Moving a project_member row to a different project must not orphan
  -- its old project, even if the new project already has an owner.
  IF TG_TABLE_NAME='project_members' AND TG_OP='UPDATE'
     AND OLD.project_id IS DISTINCT FROM NEW.project_id
     AND EXISTS(SELECT 1 FROM projects WHERE id=OLD.project_id)
     AND NOT EXISTS(
       SELECT 1 FROM project_members
       WHERE project_id=OLD.project_id AND role='owner'
     ) THEN
    RAISE EXCEPTION 'PROJECT_OWNER_REQUIRED for project %',OLD.project_id
      USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER require_project_owner_after_create
  AFTER INSERT ON projects DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_project_has_owner();

CREATE CONSTRAINT TRIGGER require_project_owner_after_member_change
  AFTER INSERT OR UPDATE OR DELETE ON project_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_project_has_owner();
