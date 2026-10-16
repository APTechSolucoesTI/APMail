CREATE TABLE google_meet_preferences (
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 declared_plan text NOT NULL DEFAULT 'unknown',
 mailbox_id uuid REFERENCES mailboxes(id) ON DELETE SET NULL,
 default_access text NOT NULL DEFAULT 'TRUSTED' CHECK(default_access IN ('OPEN','TRUSTED','RESTRICTED')),
 auto_recording boolean NOT NULL DEFAULT false,
 auto_transcription boolean NOT NULL DEFAULT false,
 auto_notes boolean NOT NULL DEFAULT false,
 sync_enabled boolean NOT NULL DEFAULT false,
 artifacts_consent boolean NOT NULL DEFAULT false,
 consented_at timestamptz,
 retention_days integer NOT NULL DEFAULT 90 CHECK(retention_days BETWEEN 30 AND 3650),
 last_check_at timestamptz,
 capabilities jsonb NOT NULL DEFAULT '{}',
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(tenant_id,user_id), CHECK(NOT sync_enabled OR artifacts_consent)
);
CREATE INDEX google_meet_preferences_user ON google_meet_preferences(user_id);
CREATE INDEX google_meet_preferences_mailbox ON google_meet_preferences(mailbox_id) WHERE mailbox_id IS NOT NULL;
ALTER TABLE google_meet_preferences ENABLE ROW LEVEL SECURITY;

CREATE TABLE google_meet_spaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 connection_id uuid NOT NULL REFERENCES google_connections(id) ON DELETE CASCADE,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 resource_name text NOT NULL, meeting_url text NOT NULL,
 app_created boolean NOT NULL DEFAULT false,
 config jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 last_sync_at timestamptz, next_sync_at timestamptz NOT NULL DEFAULT now(),
 sync_status text NOT NULL DEFAULT 'pending', sync_error_code text, sync_error text,
 UNIQUE(connection_id,resource_name), UNIQUE(id,connection_id)
);
CREATE INDEX google_meet_spaces_owner ON google_meet_spaces(tenant_id,user_id,created_at DESC);
CREATE INDEX google_meet_spaces_user ON google_meet_spaces(user_id);
CREATE INDEX google_meet_spaces_due ON google_meet_spaces(next_sync_at);
ALTER TABLE google_meet_spaces ENABLE ROW LEVEL SECURITY;

CREATE TABLE google_meet_event_links (
 space_id uuid NOT NULL REFERENCES google_meet_spaces(id) ON DELETE CASCADE,
 event_id uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
 PRIMARY KEY(space_id,event_id)
);
CREATE INDEX google_meet_event_links_event ON google_meet_event_links(event_id);
ALTER TABLE google_meet_event_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE google_meet_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 connection_id uuid NOT NULL REFERENCES google_connections(id) ON DELETE CASCADE,
 space_id uuid NOT NULL, FOREIGN KEY(space_id,connection_id) REFERENCES google_meet_spaces(id,connection_id) ON DELETE CASCADE,
 resource_name text NOT NULL,
 event_id uuid REFERENCES calendar_events(id) ON DELETE SET NULL,
 title text NOT NULL DEFAULT 'Reunião Google Meet',
 starts_at timestamptz NOT NULL, ends_at timestamptz, expires_at timestamptz,
 last_sync_at timestamptz, artifact_status jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(connection_id,resource_name), CHECK(ends_at IS NULL OR ends_at >= starts_at)
);
CREATE INDEX google_meet_records_space ON google_meet_records(space_id,starts_at DESC);
CREATE INDEX google_meet_records_date ON google_meet_records(connection_id,starts_at DESC);
CREATE INDEX google_meet_records_event ON google_meet_records(event_id) WHERE event_id IS NOT NULL;
ALTER TABLE google_meet_records ENABLE ROW LEVEL SECURITY;

CREATE TABLE google_meet_participants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 record_id uuid NOT NULL REFERENCES google_meet_records(id) ON DELETE CASCADE,
 resource_name text NOT NULL, display_name text NOT NULL DEFAULT '',
 google_user text, kind text NOT NULL CHECK(kind IN ('signed_in','anonymous','phone')),
 first_join_at timestamptz, last_leave_at timestamptz, sessions_synced_at timestamptz,
 UNIQUE(record_id,resource_name)
);
ALTER TABLE google_meet_participants ENABLE ROW LEVEL SECURITY;
CREATE TABLE google_meet_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 participant_id uuid NOT NULL REFERENCES google_meet_participants(id) ON DELETE CASCADE,
 resource_name text NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz,
 UNIQUE(participant_id,resource_name), CHECK(ends_at IS NULL OR ends_at >= starts_at)
);
ALTER TABLE google_meet_sessions ENABLE ROW LEVEL SECURITY;
CREATE TABLE google_meet_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 record_id uuid NOT NULL REFERENCES google_meet_records(id) ON DELETE CASCADE,
 resource_name text NOT NULL, kind text NOT NULL CHECK(kind IN ('recording','transcript','smart_notes')),
 state text NOT NULL, starts_at timestamptz, ends_at timestamptz,
 document_id text, external_url text, entries_status text NOT NULL DEFAULT 'pending',
 entries_error text, last_sync_at timestamptz,
 UNIQUE(record_id,resource_name)
);
ALTER TABLE google_meet_artifacts ENABLE ROW LEVEL SECURITY;
CREATE TABLE google_meet_transcript_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 artifact_id uuid NOT NULL REFERENCES google_meet_artifacts(id) ON DELETE CASCADE,
 resource_name text NOT NULL, participant_resource text NOT NULL,
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 body_text text NOT NULL, language_code text,
 UNIQUE(artifact_id,resource_name)
);
CREATE INDEX google_meet_transcript_entries_time ON google_meet_transcript_entries(artifact_id,starts_at);
ALTER TABLE google_meet_transcript_entries ENABLE ROW LEVEL SECURITY;

-- Existing app-created links remain attached; no contact/message/calendar data is removed.
INSERT INTO google_meet_spaces(connection_id,tenant_id,user_id,resource_name,meeting_url,app_created)
 SELECT DISTINCT ON(c.id,r.space_name) c.id,r.tenant_id,r.user_id,r.space_name,r.meeting_url,true
 FROM google_meeting_requests r JOIN google_connections c USING(tenant_id,user_id)
 WHERE r.status='completed' AND r.space_name IS NOT NULL AND r.meeting_url IS NOT NULL
 ON CONFLICT DO NOTHING;
INSERT INTO google_meet_event_links(space_id,event_id)
 SELECT s.id,e.id FROM google_meet_spaces s JOIN calendar_events e
 ON e.tenant_id=s.tenant_id AND e.user_id=s.user_id AND e.meeting_url=s.meeting_url
 ON CONFLICT DO NOTHING;
