-- Revocable sessions and same-project relational integrity.
CREATE TABLE sessions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_sessions_user_active ON sessions(user_id,expires_at)
  WHERE revoked_at IS NULL;

ALTER TABLE messages ADD CONSTRAINT uq_messages_project_id UNIQUE (project_id,id);
ALTER TABLE proposed_changes ADD CONSTRAINT uq_proposals_project_id UNIQUE (project_id,id);
ALTER TABLE tasks ADD CONSTRAINT uq_tasks_project_id UNIQUE (project_id,id);

ALTER TABLE proposed_changes ADD CONSTRAINT fk_proposals_source_project
  FOREIGN KEY (project_id,source_message_id) REFERENCES messages(project_id,id);
ALTER TABLE tasks ADD CONSTRAINT fk_tasks_proposal_project
  FOREIGN KEY (project_id,source_proposal_id) REFERENCES proposed_changes(project_id,id);
ALTER TABLE risks ADD CONSTRAINT fk_risks_proposal_project
  FOREIGN KEY (project_id,source_proposal_id) REFERENCES proposed_changes(project_id,id);
ALTER TABLE followup_plans ADD CONSTRAINT fk_followups_task_project
  FOREIGN KEY (project_id,task_id) REFERENCES tasks(project_id,id);
ALTER TABLE clarification_threads ADD CONSTRAINT fk_threads_proposal_project
  FOREIGN KEY (project_id,proposal_id) REFERENCES proposed_changes(project_id,id);
ALTER TABLE clarification_responses ADD CONSTRAINT fk_responses_proposal_project
  FOREIGN KEY (project_id,proposal_id) REFERENCES proposed_changes(project_id,id);
ALTER TABLE clarification_responses ADD CONSTRAINT fk_responses_message_project
  FOREIGN KEY (project_id,message_id) REFERENCES messages(project_id,id);
ALTER TABLE outbox_events ADD CONSTRAINT fk_outbox_message_project
  FOREIGN KEY (project_id,message_id) REFERENCES messages(project_id,id);
