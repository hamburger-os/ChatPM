-- ADR-090: durable outbound intents for already committed internal AI messages.
-- Unknown provider results are never automatically retried.
CREATE TABLE im_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  account_id UUID NOT NULL,
  project_id UUID NOT NULL,
  message_id UUID NOT NULL,
  external_chat_id TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending'
    CHECK(state IN ('pending','sending','accepted','unknown','failed','cancelled')),
  started_at TIMESTAMPTZ,
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(account_id,message_id),
  FOREIGN KEY(tenant_id,account_id) REFERENCES im_accounts(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY(project_id,message_id) REFERENCES messages(project_id,id) ON DELETE CASCADE
);
CREATE INDEX im_pending_deliveries ON im_deliveries(created_at) WHERE state='pending';

CREATE FUNCTION enqueue_im_ai_message() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind='ai' THEN
    INSERT INTO im_deliveries(tenant_id,account_id,project_id,message_id,external_chat_id)
    SELECT room.tenant_id,room.account_id,NEW.project_id,NEW.id,room.external_chat_id
      FROM im_room_bindings room
      JOIN im_accounts account ON account.id=room.account_id AND account.enabled
      WHERE room.project_id=NEW.project_id AND room.active;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trigger_enqueue_im_ai_message
  AFTER INSERT ON messages FOR EACH ROW EXECUTE FUNCTION enqueue_im_ai_message();
