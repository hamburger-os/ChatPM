-- Dedicated low-volume operational liveness state; not a business event log.
CREATE TABLE worker_health (
  name TEXT PRIMARY KEY CHECK (name = 'default'),
  last_seen_at TIMESTAMPTZ NOT NULL,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ
);
