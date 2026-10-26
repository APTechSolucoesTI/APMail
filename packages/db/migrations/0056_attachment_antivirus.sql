-- Private verdicts are independent of the storage metering scanner and never delete bytes.
CREATE TABLE file_security (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
 mailbox_id uuid,
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 message_id uuid REFERENCES messages(id) ON DELETE CASCADE,
 resource_id uuid,
 storage_key text NOT NULL UNIQUE,
 kind text NOT NULL CHECK(kind IN ('attachment','upload','signature_image','avatar','mail_import','mail_export','mail_raw')),
 filename text NOT NULL,
 content_type text NOT NULL DEFAULT 'application/octet-stream',
 size_bytes bigint NOT NULL CHECK(size_bytes >= 0),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','clean','infected','error')),
 generation integer NOT NULL DEFAULT 1 CHECK(generation > 0),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts >= 0),
 sha256 text CHECK(sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
 threat_name text,
 error_code text,
 engine_version text,
 signature_version text,
 definitions_at timestamptz,
 scanned_at timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_token uuid,
 lease_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(mailbox_id,tenant_id) REFERENCES mailboxes(id,tenant_id) ON DELETE CASCADE,
 CHECK(tenant_id IS NOT NULL OR kind='avatar'),
 CHECK(status <> 'clean' OR (sha256 IS NOT NULL AND scanned_at IS NOT NULL))
);
-- messages.id is globally unique. Validate its tenant/box without indexing the entire message archive again.
CREATE FUNCTION file_security_message_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.message_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM messages m WHERE m.id=NEW.message_id
   AND m.tenant_id=NEW.tenant_id AND m.mailbox_id=NEW.mailbox_id) THEN
   RAISE EXCEPTION 'file_security message scope mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER file_security_message_scope BEFORE INSERT OR UPDATE OF message_id,tenant_id,mailbox_id
 ON file_security FOR EACH ROW EXECUTE FUNCTION file_security_message_scope();
CREATE INDEX file_security_pending ON file_security(next_attempt_at,created_at) WHERE status IN ('pending','error');
CREATE INDEX file_security_tenant_status ON file_security(tenant_id,status,scanned_at DESC,id);
CREATE INDEX file_security_message ON file_security(message_id) WHERE message_id IS NOT NULL;
CREATE INDEX file_security_user ON file_security(user_id) WHERE kind='avatar';
CREATE TABLE file_scan_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 file_id uuid REFERENCES file_security(id) ON DELETE SET NULL,
 tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
 mailbox_id uuid,
 user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 message_id uuid,
 filename text NOT NULL,
 kind text NOT NULL,
 content_type text NOT NULL,
 size_bytes bigint NOT NULL,
 generation integer NOT NULL,
 attempt integer NOT NULL,
 status text NOT NULL CHECK(status IN ('clean','infected','error')),
 sha256 text,
 threat_name text,
 error_code text,
 engine_version text,
 signature_version text,
 definitions_at timestamptz,
 duration_ms integer NOT NULL DEFAULT 0,
 scanned_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(file_id,generation,attempt)
);
CREATE INDEX file_scan_history_tenant ON file_scan_history(tenant_id,scanned_at DESC,id);
CREATE TABLE antivirus_health (
 id integer PRIMARY KEY CHECK(id=1),
 status text NOT NULL CHECK(status IN ('online','offline','error','unavailable')),
 engine_version text,
 signature_version text,
 definitions_at timestamptz,
 checked_at timestamptz NOT NULL DEFAULT now(),
 error_code text,
 last_alert_at timestamptz,
 alert_key text
);
ALTER TABLE file_security ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_scan_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE antivirus_health ENABLE ROW LEVEL SECURITY;
-- Fastify/worker use the existing private DB connection and enforce tenant/admin access.
-- No public SQL grants or permissive policies are introduced.
