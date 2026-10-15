-- ADR-053: Independent optimistic version for department/program/portfolio
-- classification; do not conflate it with owner/settings/AI authorization.
ALTER TABLE projects
  ADD COLUMN classification_revision INTEGER NOT NULL DEFAULT 1
  CHECK(classification_revision>0);
