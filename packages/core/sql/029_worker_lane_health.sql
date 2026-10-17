-- ADR-080: a successful reminder cannot mask a failing event or report lane.
-- This is a one-way telemetry schema cutover performed while services are stopped.
DELETE FROM worker_health WHERE name='default';
ALTER TABLE worker_health DROP CONSTRAINT worker_health_name_check;
ALTER TABLE worker_health
  ADD CONSTRAINT worker_health_name_check
  CHECK (name IN ('events','reminders','reports'));
