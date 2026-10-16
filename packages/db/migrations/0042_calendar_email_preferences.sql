CREATE TABLE calendar_email_preferences (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 message_template text CHECK (char_length(message_template) BETWEEN 1 AND 10000),
 mailbox_id uuid REFERENCES mailboxes(id) ON DELETE SET NULL,
 signature_mode text NOT NULL DEFAULT 'default' CHECK (signature_mode IN ('default','none','selected')),
 signature_id uuid REFERENCES signatures(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id,user_id)
);
CREATE INDEX calendar_email_preferences_user ON calendar_email_preferences(user_id);
CREATE INDEX calendar_email_preferences_mailbox ON calendar_email_preferences(mailbox_id) WHERE mailbox_id IS NOT NULL;
CREATE INDEX calendar_email_preferences_signature ON calendar_email_preferences(signature_id) WHERE signature_id IS NOT NULL;
ALTER TABLE calendar_email_preferences ENABLE ROW LEVEL SECURITY;
