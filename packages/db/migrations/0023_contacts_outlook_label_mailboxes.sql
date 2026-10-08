-- Directory companies are retired. Existing contact scope stays global; new scope comes from tenant settings.
ALTER TABLE contacts DISABLE TRIGGER storage_payload_track;
ALTER TABLE contacts ADD COLUMN scope text NOT NULL DEFAULT 'tenant' CHECK(scope IN ('tenant','personal'));
ALTER TABLE contacts ADD COLUMN owner_user_id uuid REFERENCES users(id);
ALTER TABLE contacts ADD COLUMN updated_by uuid REFERENCES users(id);
ALTER TABLE contacts ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE contacts ADD COLUMN company text NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN first_name text NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN middle_name text NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN last_name text NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN prefix text NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN suffix text NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN department text NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN office text NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN website text NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN birthday text NOT NULL DEFAULT '';
ALTER TABLE contacts ADD COLUMN addresses jsonb NOT NULL DEFAULT '[]';
ALTER TABLE contacts DROP CONSTRAINT contacts_name_check;
ALTER TABLE contacts ADD CHECK(length(trim(name)) BETWEEN 2 AND 200);
ALTER TABLE contacts ADD CHECK((scope='personal')=(owner_user_id IS NOT NULL));
UPDATE contacts SET updated_by=(SELECT a.actor_id FROM audit_logs a JOIN users u ON u.id=a.actor_id WHERE a.tenant_id=contacts.tenant_id AND a.entity_type='contact' AND a.entity_id=contacts.id AND a.action IN ('contact.created','contact.updated') ORDER BY a.created_at DESC,a.id DESC LIMIT 1),company=coalesce((SELECT cc.name FROM contact_company_links l JOIN contact_companies cc ON cc.id=l.company_id WHERE l.contact_id=contacts.id AND l.is_primary LIMIT 1),'');
ALTER TABLE contacts DROP COLUMN visibility;
ALTER TABLE contact_emails DROP CONSTRAINT contact_emails_tenant_id_email_key;
ALTER TABLE contact_emails ADD COLUMN agenda_user_id uuid REFERENCES users(id);
CREATE UNIQUE INDEX contact_email_scope_unique ON contact_emails(tenant_id,coalesce(agenda_user_id,'00000000-0000-0000-0000-000000000000'::uuid),email);
CREATE INDEX contacts_agenda ON contacts(tenant_id,scope,owner_user_id);
CREATE FUNCTION contact_agenda_guard() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 SELECT owner_user_id INTO NEW.agenda_user_id FROM contacts WHERE id=NEW.contact_id AND tenant_id=NEW.tenant_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_contact'; END IF; RETURN NEW; END $$;
CREATE TRIGGER contact_email_agenda BEFORE INSERT OR UPDATE ON contact_emails FOR EACH ROW EXECUTE FUNCTION contact_agenda_guard();
-- Explicitly discard obsolete test-only directory records, without retaining an archive.
DELETE FROM storage_logical_payloads WHERE relation_name IN ('contact_company_links','contact_email_links','contact_addresses','contact_mailboxes','contact_company_mailboxes','contact_companies','directory_legacy');
DELETE FROM storage_logical_catalog WHERE relation_name IN ('contact_company_links','contact_email_links','contact_addresses','contact_mailboxes','contact_company_mailboxes','contact_companies','directory_legacy');
DROP VIEW storage_logical_rows_v2;
DROP VIEW storage_logical_rows;
DROP TABLE contact_company_links,contact_email_links,contact_mailboxes,contact_company_mailboxes,contact_addresses,contact_companies,directory_legacy;
DROP FUNCTION directory_obsolete_write();
DELETE FROM storage_logical_payloads WHERE relation_name='contacts';
INSERT INTO storage_logical_payloads SELECT 'contacts',jsonb_build_object('id',c.id)::text,c.tenant_id,NULL,'contacts',0,octet_length(to_jsonb(c)::text),false FROM contacts c;
ALTER TABLE contacts ENABLE TRIGGER storage_payload_track;
ALTER TABLE personal_labels ADD COLUMN mailbox_mode text NOT NULL DEFAULT 'all' CHECK(mailbox_mode IN ('all','selected'));
CREATE TABLE label_mailboxes(tenant_id uuid NOT NULL,label_id uuid NOT NULL,mailbox_id uuid NOT NULL,PRIMARY KEY(label_id,mailbox_id),FOREIGN KEY(tenant_id,label_id) REFERENCES personal_labels(tenant_id,id) ON DELETE CASCADE,FOREIGN KEY(tenant_id,mailbox_id) REFERENCES mailboxes(tenant_id,id) ON DELETE CASCADE);
ALTER TABLE mail_rules ADD COLUMN review_reason text;
ALTER TABLE mail_rules DISABLE TRIGGER storage_payload_track;
UPDATE mail_rules r SET is_active=false,review_reason='Revise a etiqueta: minhas regras aceitam apenas etiquetas pessoais.' WHERE r.scope='personal' AND EXISTS(SELECT 1 FROM jsonb_array_elements(r.actions) a JOIN personal_labels l ON l.id::text=a->>'label_id' WHERE a->>'type'='add_label' AND l.scope='tenant');
CREATE TABLE contact_imports(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),user_id uuid NOT NULL REFERENCES users(id),mode text NOT NULL CHECK(mode IN ('tenant','personal')),duplicates text CHECK(duplicates IN ('skip','update')),rows jsonb NOT NULL,results jsonb NOT NULL DEFAULT '[]',cursor integer NOT NULL DEFAULT 0,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',UNIQUE(tenant_id,id));
INSERT INTO storage_logical_catalog VALUES ('label_mailboxes','rules','tenant_id','{}'),('contact_imports','contacts','tenant_id','{}');
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON label_mailboxes FOR EACH ROW EXECUTE FUNCTION storage_track_payload('label_id,mailbox_id','rules','tenant_id','');
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON contact_imports FOR EACH ROW EXECUTE FUNCTION storage_track_payload('id','contacts','tenant_id','');
-- Stamp scope immutably and serialize name validation with all contact writes.
ALTER TABLE contacts ADD CONSTRAINT contact_agenda_member FOREIGN KEY(tenant_id,owner_user_id) REFERENCES tenant_members(tenant_id,user_id);
CREATE FUNCTION contact_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM 1 FROM tenants WHERE id=NEW.tenant_id FOR UPDATE;
 IF TG_OP='UPDATE' AND (NEW.scope IS DISTINCT FROM OLD.scope OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id OR NEW.created_by IS DISTINCT FROM OLD.created_by) THEN RAISE EXCEPTION 'contact_scope_immutable'; END IF;
 IF NEW.scope='tenant' AND EXISTS(SELECT 1 FROM contacts c WHERE c.tenant_id=NEW.tenant_id AND c.scope='tenant' AND c.id<>NEW.id AND lower(unaccent(regexp_replace(btrim(c.name),'\s+',' ','g')))=lower(unaccent(regexp_replace(btrim(NEW.name),'\s+',' ','g')))) THEN
  RAISE EXCEPTION 'contact_global_name_duplicate' USING ERRCODE='23505';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contact_scope_validation BEFORE INSERT OR UPDATE ON contacts FOR EACH ROW EXECUTE FUNCTION contact_scope_guard();
CREATE FUNCTION label_mailbox_application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM personal_labels l JOIN threads t ON t.id=NEW.thread_id AND t.tenant_id=l.tenant_id WHERE l.id=NEW.label_id AND l.tenant_id=NEW.tenant_id AND (l.mailbox_mode='all' OR EXISTS(SELECT 1 FROM label_mailboxes lm WHERE lm.label_id=l.id AND lm.mailbox_id=t.mailbox_id AND lm.tenant_id=l.tenant_id))) THEN RAISE EXCEPTION 'label_mailbox_unavailable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER label_mailbox_application BEFORE INSERT OR UPDATE ON thread_personal_labels FOR EACH ROW EXECUTE FUNCTION label_mailbox_application_guard();
CREATE FUNCTION rule_label_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE action jsonb;
BEGIN
 PERFORM 1 FROM tenants WHERE id=NEW.tenant_id FOR UPDATE;
 IF NEW.is_active AND NEW.deleted_at IS NULL THEN
  FOR action IN SELECT value FROM jsonb_array_elements(NEW.actions) LOOP
   IF action->>'type'='add_label' AND NOT EXISTS(SELECT 1 FROM personal_labels l WHERE l.id::text=action->>'label_id' AND l.tenant_id=NEW.tenant_id AND ((NEW.scope='personal' AND l.scope='personal' AND l.user_id=NEW.owner_user_id) OR (NEW.scope='mailbox' AND l.scope='tenant')) AND (l.mailbox_mode='all' OR EXISTS(SELECT 1 FROM label_mailboxes lm WHERE lm.label_id=l.id AND lm.tenant_id=l.tenant_id AND lm.mailbox_id=NEW.mailbox_id))) THEN RAISE EXCEPTION 'invalid_rule_label'; END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER rule_label_validation BEFORE INSERT OR UPDATE ON mail_rules FOR EACH ROW EXECUTE FUNCTION rule_label_guard();
-- ALTER ADD COLUMN does not fire row triggers: refresh projections without enforcing pre-existing full quotas.
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['contacts','contact_emails','personal_labels','mail_rules'] LOOP
  EXECUTE format('DELETE FROM storage_logical_payloads WHERE relation_name=%L',relation);
  EXECUTE format('INSERT INTO storage_logical_payloads SELECT %L,jsonb_build_object(''id'',r.id)::text,r.tenant_id,CASE WHEN c.owner_column=''mailbox_id'' THEN (to_jsonb(r)->>''mailbox_id'')::uuid ELSE NULL END,c.category,0,octet_length((to_jsonb(r)-c.excluded_columns)::text),(to_jsonb(r)->>''deleted_at'') IS NOT NULL FROM %I r JOIN storage_logical_catalog c ON c.relation_name=%L',relation,relation,relation);
 END LOOP;
END $$;

ALTER TABLE mail_rules ENABLE TRIGGER storage_payload_track;
