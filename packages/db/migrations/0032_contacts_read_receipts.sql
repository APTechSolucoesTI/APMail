-- Additive protocol metadata: preserve contacts, messages and existing preferences.
ALTER TABLE user_preferences ADD COLUMN request_read_receipt boolean NOT NULL DEFAULT false;
ALTER TABLE outbox ADD COLUMN request_read_receipt boolean NOT NULL DEFAULT false;
ALTER TABLE outbox ADD COLUMN mdn_original_message_id uuid;
ALTER TABLE outbox ADD FOREIGN KEY (mdn_original_message_id,tenant_id,mailbox_id) REFERENCES messages(id,tenant_id,mailbox_id);
ALTER TABLE outbox ADD CHECK (mdn_original_message_id IS NULL OR NOT request_read_receipt);
ALTER TABLE messages ADD COLUMN request_read_receipt boolean NOT NULL DEFAULT false;
ALTER TABLE messages ADD COLUMN mdn_request jsonb;
ALTER TABLE messages ADD COLUMN is_mdn boolean NOT NULL DEFAULT false;
CREATE INDEX contact_email_normalized_lookup ON contact_emails(tenant_id,lower(btrim(email)),agenda_user_id);
CREATE INDEX message_mdn_original_lookup ON messages(tenant_id,mailbox_id,message_id_header) WHERE direction='outbound' AND request_read_receipt AND deleted_at IS NULL;

-- A mailbox identity can decide only once, including duplicate deliveries / imported copies.
CREATE TABLE mdn_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 mailbox_id uuid NOT NULL,
 message_id_header text NOT NULL,
 original_message_id uuid NOT NULL,
 recipient_address text NOT NULL,
 notification_to text NOT NULL,
 decision text NOT NULL CHECK(decision IN ('confirm','decline')),
 actor_id uuid NOT NULL REFERENCES users(id),
 outbox_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,mailbox_id,message_id_header),
 FOREIGN KEY(original_message_id,tenant_id,mailbox_id) REFERENCES messages(id,tenant_id,mailbox_id) ON DELETE CASCADE,
 FOREIGN KEY(outbox_id,tenant_id,mailbox_id) REFERENCES outbox(id,tenant_id,mailbox_id) ON DELETE SET NULL (outbox_id),
 CHECK((decision='confirm')=(outbox_id IS NOT NULL))
);
CREATE TABLE mdn_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 mailbox_id uuid NOT NULL,
 original_message_id uuid NOT NULL,
 receipt_message_id uuid NOT NULL,
 recipient_address text NOT NULL,
 disposition text NOT NULL CHECK(disposition IN ('displayed','deleted','dispatched','processed')),
 received_at timestamptz NOT NULL DEFAULT now(),
 reported_at timestamptz,
 UNIQUE(original_message_id,recipient_address,disposition),
 FOREIGN KEY(original_message_id,tenant_id,mailbox_id) REFERENCES messages(id,tenant_id,mailbox_id) ON DELETE CASCADE,
 FOREIGN KEY(receipt_message_id,tenant_id,mailbox_id) REFERENCES messages(id,tenant_id,mailbox_id) ON DELETE CASCADE
);
-- No browser Data API in this architecture. Fastify scopes every operation;
-- RLS denies direct non-owner SQL access (same service role model as existing tables).
ALTER TABLE mdn_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE mdn_receipts ENABLE ROW LEVEL SECURITY;
INSERT INTO storage_logical_catalog VALUES ('mdn_decisions','messages','mailbox_id','{}'),('mdn_receipts','messages','mailbox_id','{}');
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON mdn_decisions FOR EACH ROW EXECUTE FUNCTION storage_track_payload('id','messages','mailbox_id','');
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON mdn_receipts FOR EACH ROW EXECUTE FUNCTION storage_track_payload('id','messages','mailbox_id','');
