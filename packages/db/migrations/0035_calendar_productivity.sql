-- Personal calendars use the existing authenticated Fastify tenant/user boundary.
-- Direct non-owner SQL access is denied, as with the other private tables.
CREATE TABLE calendars (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 color text NOT NULL DEFAULT '#1686A7' CHECK(color ~ '^#[0-9a-fA-F]{6}$'),
 timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id,user_id)
);
CREATE INDEX calendars_owner ON calendars(tenant_id,user_id);
CREATE TABLE calendar_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 user_id uuid NOT NULL,
 calendar_id uuid NOT NULL,
 mailbox_id uuid,
 uid text NOT NULL CHECK(length(uid) BETWEEN 1 AND 998),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
 description text NOT NULL DEFAULT '',
 location text NOT NULL DEFAULT '',
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 timezone text NOT NULL,
 all_day boolean NOT NULL DEFAULT false,
 is_private boolean NOT NULL DEFAULT false,
 category text NOT NULL DEFAULT '',
 color text CHECK(color ~ '^#[0-9a-fA-F]{6}$'),
 organizer text,
 attendees jsonb NOT NULL DEFAULT '[]',
 rrule text,
 exceptions jsonb NOT NULL DEFAULT '[]',
 sequence integer NOT NULL DEFAULT 0 CHECK(sequence>=0),
 external boolean NOT NULL DEFAULT false,
 status text NOT NULL DEFAULT 'confirmed' CHECK(status IN ('confirmed','cancelled')),
 reminder_minutes integer CHECK(reminder_minutes BETWEEN 0 AND 525600),
 reminder_cursor timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,user_id,uid),
 UNIQUE(id,tenant_id,user_id),
 FOREIGN KEY(calendar_id,tenant_id,user_id) REFERENCES calendars(id,tenant_id,user_id) ON DELETE CASCADE,
 FOREIGN KEY(mailbox_id,tenant_id) REFERENCES mailboxes(id,tenant_id),
 CHECK(ends_at>starts_at)
);
CREATE INDEX calendar_events_range ON calendar_events(tenant_id,user_id,starts_at,ends_at);
CREATE INDEX calendar_events_meeting ON calendar_events(tenant_id,mailbox_id,uid) WHERE organizer IS NOT NULL;
CREATE INDEX calendar_event_alarms ON calendar_events(reminder_cursor) WHERE reminder_minutes IS NOT NULL AND status='confirmed';
CREATE TABLE reminders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 event_id uuid,
 occurrence_at timestamptz,
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 300),
 notes text NOT NULL DEFAULT '',
 due_at timestamptz NOT NULL,
 recurrence jsonb,
 recurrence_start timestamptz,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','notified','dismissed','completed')),
 notification_id uuid REFERENCES notifications(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(event_id,tenant_id,user_id) REFERENCES calendar_events(id,tenant_id,user_id) ON DELETE CASCADE,
 UNIQUE(event_id,occurrence_at)
);
CREATE INDEX reminder_due ON reminders(due_at) WHERE status='pending';
CREATE INDEX reminder_owner ON reminders(tenant_id,user_id,status,due_at);
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'reminder';
ALTER TABLE messages ADD COLUMN calendar_invite jsonb;
ALTER TABLE outbox ADD COLUMN calendar_payload jsonb;
ALTER TABLE outbox ADD COLUMN priority text NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high'));
ALTER TABLE calendars ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE reminders ENABLE ROW LEVEL SECURITY;
