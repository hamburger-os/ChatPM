-- ADR-043: Draft report revisions and accountable publication.
-- Never infer a historical published timestamp or actor for legacy records.
ALTER TABLE reports
  ADD COLUMN revision INTEGER NOT NULL DEFAULT 1 CHECK (revision>0),
  ADD COLUMN published_at TIMESTAMPTZ,
  ADD COLUMN published_by UUID REFERENCES users(id);
