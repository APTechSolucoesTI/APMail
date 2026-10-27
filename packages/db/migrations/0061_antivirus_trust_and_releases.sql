-- Keep ClamAV evidence separate from an administrator's explicit access decision.
CREATE TABLE antivirus_sender_rules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 mailbox_id uuid,
 sender text NOT NULL CHECK(sender=lower(btrim(sender)) AND length(sender) BETWEEN 3 AND 254),
 policy text NOT NULL DEFAULT 'encrypted' CHECK(policy IN ('encrypted','preventive')),
 notes text NOT NULL DEFAULT '' CHECK(length(notes)<=2000),
 enabled boolean NOT NULL DEFAULT true,
 expires_at timestamptz,
 created_by uuid REFERENCES users(id) ON DELETE SET NULL,
 updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id),
 FOREIGN KEY(mailbox_id,tenant_id) REFERENCES mailboxes(id,tenant_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX antivirus_sender_rule_scope ON antivirus_sender_rules(tenant_id,sender,coalesce(mailbox_id,'00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX antivirus_sender_rule_lookup ON antivirus_sender_rules(tenant_id,sender) WHERE enabled;
ALTER TABLE file_security ADD COLUMN released_at timestamptz;
ALTER TABLE file_security ADD COLUMN released_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE file_security ADD COLUMN release_reason text;
ALTER TABLE file_security ADD COLUMN release_sha256 text CHECK(release_sha256 IS NULL OR release_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE file_security ADD COLUMN release_generation integer;
ALTER TABLE file_security ADD COLUMN release_rule_id uuid REFERENCES antivirus_sender_rules(id) ON DELETE SET NULL;
ALTER TABLE file_security ADD COLUMN release_kind text CHECK(release_kind IN ('manual','sender'));
ALTER TABLE file_security ADD COLUMN false_positive boolean NOT NULL DEFAULT false;
ALTER TABLE file_security ADD CONSTRAINT file_release_evidence CHECK(released_at IS NULL OR (tenant_id IS NOT NULL AND kind IN ('attachment','upload') AND release_sha256 IS NOT NULL AND release_generation IS NOT NULL AND release_reason IS NOT NULL AND release_kind IS NOT NULL));
CREATE INDEX file_security_released ON file_security(tenant_id,released_at DESC) WHERE released_at IS NOT NULL;
CREATE TABLE file_security_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
 file_id uuid NOT NULL REFERENCES file_security(id) ON DELETE CASCADE,
 action text NOT NULL CHECK(action IN ('release','revoke')),
 actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
 rule_id uuid REFERENCES antivirus_sender_rules(id) ON DELETE SET NULL,
 reason text NOT NULL,
 false_positive boolean NOT NULL DEFAULT false,
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 generation integer NOT NULL,
 scan_status text NOT NULL,
 threat_name text,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX file_security_decision_history ON file_security_decisions(tenant_id,created_at DESC,id);
CREATE FUNCTION antivirus_decision_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM file_security f WHERE f.id=NEW.file_id AND f.tenant_id=NEW.tenant_id) THEN
  RAISE EXCEPTION 'file decision tenant mismatch' USING ERRCODE='23514';
 END IF;
 IF NEW.rule_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM antivirus_sender_rules r WHERE r.id=NEW.rule_id AND r.tenant_id=NEW.tenant_id) THEN
  RAISE EXCEPTION 'sender rule tenant mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER antivirus_decision_scope BEFORE INSERT OR UPDATE ON file_security_decisions FOR EACH ROW EXECUTE FUNCTION antivirus_decision_scope();
ALTER TABLE antivirus_sender_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_security_decisions ENABLE ROW LEVEL SECURITY;
-- These private tables use the existing Fastify/worker connection. No public grants.
