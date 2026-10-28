-- Preserve standard administrators; custom profiles must explicitly delegate security decisions.
UPDATE access_profiles SET permissions=ARRAY(SELECT DISTINCT p FROM unnest(permissions || ARRAY['antivirus.view','antivirus.release','antivirus.trust']) p)
WHERE system_role IN ('owner','admin');
CREATE FUNCTION seed_antivirus_profile_permissions() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.system_role IN ('owner','admin') THEN
  NEW.permissions=ARRAY(SELECT DISTINCT p FROM unnest(NEW.permissions || ARRAY['antivirus.view','antivirus.release','antivirus.trust']) p);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER seed_antivirus_profile_permissions BEFORE INSERT ON access_profiles FOR EACH ROW EXECUTE FUNCTION seed_antivirus_profile_permissions();
ALTER TABLE antivirus_sender_rules DROP CONSTRAINT antivirus_sender_rules_policy_check;
ALTER TABLE antivirus_sender_rules ADD CONSTRAINT antivirus_sender_rules_policy_check CHECK(policy IN ('encrypted','preventive','trusted'));
ALTER TABLE antivirus_sender_rules ALTER COLUMN policy SET DEFAULT 'trusted';
COMMENT ON COLUMN antivirus_sender_rules.policy IS 'Legacy compatibility field. Sender trust now authorizes all attachment findings independently of the ClamAV result.';
CREATE INDEX file_security_rule_release ON file_security(tenant_id,release_rule_id) WHERE release_rule_id IS NOT NULL;
