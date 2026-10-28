CREATE TABLE tenant_domains (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 domain text NOT NULL CHECK(domain=lower(domain) AND length(domain)<=253), display_name text NOT NULL,
 dkim_selector text CHECK(dkim_selector IS NULL OR dkim_selector ~ '^[a-zA-Z0-9_-]{0,63}$'),
 created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tenant_id,domain), UNIQUE(tenant_id,id)
);
CREATE TRIGGER tenant_domains_updated BEFORE UPDATE ON tenant_domains FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TABLE tenant_domain_checks (
 domain_id uuid PRIMARY KEY, tenant_id uuid NOT NULL,
 snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object' AND octet_length(snapshot::text)<=65536),
 checked_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,domain_id) REFERENCES tenant_domains(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE mailboxes ADD COLUMN domain_id uuid;
ALTER TABLE mailboxes ADD CONSTRAINT mailbox_domain_tenant FOREIGN KEY(tenant_id,domain_id) REFERENCES tenant_domains(tenant_id,id);
CREATE INDEX mailbox_domain ON mailboxes(tenant_id,domain_id);
INSERT INTO tenant_domains(tenant_id,domain,display_name)
 SELECT DISTINCT tenant_id,lower(split_part(email_address,'@',2)),lower(split_part(email_address,'@',2)) FROM mailboxes WHERE email_address ~ '^[^@]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$' ON CONFLICT DO NOTHING;
UPDATE mailboxes b SET domain_id=d.id FROM tenant_domains d WHERE b.tenant_id=d.tenant_id AND lower(split_part(b.email_address,'@',2))=d.domain;
ALTER TABLE user_preferences ADD COLUMN mail_group_by_domain boolean NOT NULL DEFAULT false;
UPDATE access_profiles SET permissions=ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['domains.view','domains.manage']) p) WHERE system_role IN('owner','admin');
CREATE FUNCTION seed_domain_permissions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.system_role IN('owner','admin') THEN NEW.permissions=ARRAY(SELECT DISTINCT p FROM unnest(NEW.permissions || ARRAY['domains.view','domains.manage']) p); END IF; RETURN NEW; END $$;
CREATE TRIGGER seed_domain_permissions BEFORE INSERT ON access_profiles FOR EACH ROW EXECUTE FUNCTION seed_domain_permissions();
