-- ADR-045: Monotonic human recovery generation for the same dead-letter event.
-- Existing Outbox data keeps its identity and processing history.
ALTER TABLE outbox_events ADD COLUMN manual_retry_revision INTEGER NOT NULL DEFAULT 0
  CHECK(manual_retry_revision>=0);
