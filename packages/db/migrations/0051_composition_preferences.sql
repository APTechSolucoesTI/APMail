-- Personal typography defaults, with independent overrides for each accessible mailbox.
ALTER TABLE user_preferences ADD COLUMN composition_format jsonb;
ALTER TABLE user_preferences ADD CONSTRAINT composition_format_object
 CHECK (composition_format IS NULL OR jsonb_typeof(composition_format) = 'object');

CREATE TABLE mailbox_composition_preferences (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 mailbox_id uuid NOT NULL,
 format jsonb NOT NULL CHECK (jsonb_typeof(format) = 'object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (tenant_id, user_id, mailbox_id),
 FOREIGN KEY (mailbox_id, tenant_id) REFERENCES mailboxes(id, tenant_id) ON DELETE CASCADE,
 FOREIGN KEY (tenant_id, user_id) REFERENCES tenant_members(tenant_id, user_id) ON DELETE CASCADE
);
CREATE INDEX mailbox_composition_preferences_user ON mailbox_composition_preferences(user_id);
CREATE INDEX mailbox_composition_preferences_mailbox ON mailbox_composition_preferences(mailbox_id, tenant_id);
-- Application connections enforce user and tenant authorization in the API, as in existing preferences.
ALTER TABLE mailbox_composition_preferences ENABLE ROW LEVEL SECURITY;
