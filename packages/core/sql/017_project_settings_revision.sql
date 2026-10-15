-- ADR-044: Distinguish project settings optimistic version from AI authorization version.
ALTER TABLE projects ADD COLUMN settings_revision INTEGER NOT NULL DEFAULT 1
  CHECK (settings_revision>0);
