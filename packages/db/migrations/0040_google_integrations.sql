CREATE TABLE google_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 google_subject text NOT NULL,
 email text NOT NULL,
 scopes text[] NOT NULL DEFAULT '{}',
 encrypted_tokens text NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,user_id)
);
CREATE INDEX google_connections_user ON google_connections(user_id);
ALTER TABLE google_connections ENABLE ROW LEVEL SECURITY;
CREATE TABLE google_meeting_requests (
 id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 status text NOT NULL CHECK(status IN ('pending','completed','failed','uncertain')),
 meeting_url text,
 space_name text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX google_meeting_requests_owner ON google_meeting_requests(tenant_id,user_id,created_at);
CREATE INDEX google_meeting_requests_user ON google_meeting_requests(user_id);
ALTER TABLE google_meeting_requests ENABLE ROW LEVEL SECURITY;
