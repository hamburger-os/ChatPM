-- Preserve historical capacity plans, but allow organization administrators to
-- cancel obsolete commitments before reassigning or removing a project member.
ALTER TABLE resource_allocations
  ADD COLUMN cancelled_at TIMESTAMPTZ,
  ADD COLUMN cancelled_by UUID REFERENCES users(id);
ALTER TABLE resource_allocations
  ADD CONSTRAINT ck_allocation_cancellation_actor
  CHECK ((cancelled_at IS NULL) = (cancelled_by IS NULL));
CREATE INDEX idx_allocations_active_assignment
  ON resource_allocations(project_id,user_id,end_date)
  WHERE cancelled_at IS NULL;
