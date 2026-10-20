ALTER TABLE mail_rules DROP CONSTRAINT mail_rules_match_mode_check;
ALTER TABLE mail_rules ADD CONSTRAINT mail_rules_match_mode_check CHECK (match_mode IN ('all','any','always'));
ALTER TABLE mail_rules ADD COLUMN exceptions jsonb NOT NULL DEFAULT '[]',
  ADD COLUMN active_from timestamptz, ADD COLUMN active_until timestamptz;
ALTER TABLE mail_rules ADD CONSTRAINT mail_rules_active_period CHECK
  (active_from IS NULL OR active_until IS NULL OR active_until > active_from);
ALTER TABLE messages ADD COLUMN auto_reply_to text,
  ADD COLUMN is_auto_reply boolean NOT NULL DEFAULT false;
ALTER TABLE outbox ADD COLUMN is_auto_reply boolean NOT NULL DEFAULT false;
ALTER TABLE outbox ADD CONSTRAINT outbox_auto_reply_rule CHECK
  (NOT is_auto_reply OR (created_by_rule_id IS NOT NULL AND kind='reply' AND reply_to_message_id IS NOT NULL));
CREATE TABLE mail_auto_reply_state (
  tenant_id uuid NOT NULL, mailbox_id uuid NOT NULL,
  address text NOT NULL CHECK (length(address) BETWEEN 3 AND 254 AND address=lower(address)),
  last_replied_at timestamptz NOT NULL DEFAULT now(),
  outbox_id uuid REFERENCES outbox(id) ON DELETE SET NULL,
  PRIMARY KEY(mailbox_id,address),
  FOREIGN KEY(mailbox_id,tenant_id) REFERENCES mailboxes(id,tenant_id) ON DELETE CASCADE
);
INSERT INTO storage_logical_catalog VALUES
 ('mail_auto_reply_state','metadata','mailbox_id',ARRAY['last_replied_at']);
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON mail_auto_reply_state FOR EACH ROW
 EXECUTE FUNCTION storage_track_payload('mailbox_id,address','metadata','mailbox_id','last_replied_at');
