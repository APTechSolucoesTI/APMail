-- Preserve identifiers and legacy data; deploy API/web/worker together.
CREATE TABLE contact_company_links (
 tenant_id uuid NOT NULL, contact_id uuid NOT NULL, company_id uuid NOT NULL,
 is_primary boolean NOT NULL DEFAULT false,
 PRIMARY KEY(contact_id,company_id),
 FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,company_id) REFERENCES contact_companies(tenant_id,id)
);
CREATE UNIQUE INDEX contact_company_primary ON contact_company_links(contact_id) WHERE is_primary;
WITH companies AS (
 SELECT tenant_id,contact_id,company_id,bool_or(is_primary_company) AS preferred
 FROM contact_email_links WHERE company_id IS NOT NULL GROUP BY tenant_id,contact_id,company_id
), ranked AS (
 SELECT *,row_number() OVER(PARTITION BY contact_id ORDER BY preferred DESC,company_id) AS position FROM companies
)
INSERT INTO contact_company_links SELECT tenant_id,contact_id,company_id,position=1 FROM ranked;

CREATE TABLE contact_user_nicknames (
 tenant_id uuid NOT NULL,contact_id uuid NOT NULL,user_id uuid NOT NULL,
 nickname text NOT NULL CHECK(length(btrim(nickname)) BETWEEN 1 AND 120),
 PRIMARY KEY(contact_id,user_id),
 FOREIGN KEY(tenant_id,contact_id) REFERENCES contacts(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,user_id) REFERENCES tenant_members(tenant_id,user_id) ON DELETE CASCADE
);
CREATE INDEX contact_nickname_user ON contact_user_nicknames(tenant_id,user_id);

-- Retained legacy is tenant-owned and remains accounted for, independently of contacts.
CREATE TABLE directory_legacy (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),
 source text NOT NULL,source_key text NOT NULL,payload jsonb NOT NULL,
 deleted_at timestamptz NOT NULL DEFAULT now(),UNIQUE(tenant_id,source,source_key)
);
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['contact_email_links','contact_addresses','contact_mailboxes','contact_company_mailboxes'] LOOP
  EXECUTE format('INSERT INTO directory_legacy(tenant_id,source,source_key,payload) SELECT tenant_id,%L,coalesce(to_jsonb(r)->>''id'',jsonb_build_object(''contact_id'',to_jsonb(r)->''contact_id'',''company_id'',to_jsonb(r)->''company_id'',''mailbox_id'',to_jsonb(r)->''mailbox_id'')::text),to_jsonb(r) FROM %I r',relation,relation);
 END LOOP;
END $$;
INSERT INTO directory_legacy(tenant_id,source,source_key,payload)
 SELECT tenant_id,'contact_visibility',id::text,jsonb_build_object('contact_id',id,'visibility',visibility) FROM contacts WHERE visibility<>'all';
INSERT INTO directory_legacy(tenant_id,source,source_key,payload)
 SELECT tenant_id,'company_visibility',id::text,jsonb_build_object('company_id',id,'visibility',visibility) FROM contact_companies WHERE visibility<>'all';
INSERT INTO directory_legacy(tenant_id,source,source_key,payload)
 SELECT tenant_id,'email_label',id::text,to_jsonb(e) FROM contact_emails e WHERE label<>'';
-- Merge postal data created after 0021 into each company's canonical address set.
ALTER TABLE contact_companies DISABLE TRIGGER storage_payload_track;
ALTER TABLE contacts DISABLE TRIGGER storage_payload_track;
UPDATE contact_companies cc SET addresses=(
 SELECT coalesce(jsonb_agg(address ORDER BY origin,position),'[]') FROM (
  SELECT DISTINCT ON (normalized) address,origin,position FROM (
   SELECT combined.*, (SELECT jsonb_object_agg(key,CASE WHEN key='cep' THEN regexp_replace(value,'[^0-9]','','g') ELSE lower(unaccent(regexp_replace(btrim(value),'\s+',' ','g'))) END) FROM jsonb_each_text(address)) AS normalized FROM (
  SELECT value AS address,0 AS origin,ordinality::text AS position FROM jsonb_array_elements(cc.addresses) WITH ORDINALITY
  UNION ALL SELECT to_jsonb(a)-'id'-'tenant_id',1,a.id::text FROM contact_email_links l
   JOIN contact_addresses a ON a.id=l.address_id AND a.tenant_id=l.tenant_id
   WHERE l.company_id=cc.id AND l.tenant_id=cc.tenant_id
   ) combined
  ) normalized_addresses ORDER BY normalized,origin,position
 ) deduplicated
),visibility='all';
UPDATE contacts SET visibility='all';
DELETE FROM contact_email_links;
DELETE FROM contact_addresses;
DELETE FROM contact_mailboxes;
DELETE FROM contact_company_mailboxes;
-- Keep obsolete relations for compatibility with schema tooling, disallow new writes.
CREATE FUNCTION directory_obsolete_write() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'obsolete_contact_relationship'; END $$;
DO $$ DECLARE relation text; BEGIN
 FOREACH relation IN ARRAY ARRAY['contact_email_links','contact_addresses','contact_mailboxes','contact_company_mailboxes'] LOOP
  EXECUTE format('CREATE TRIGGER directory_obsolete BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION directory_obsolete_write()',relation);
 END LOOP;
END $$;

-- Physical names retained to preserve rule IDs and external schema compatibility.
ALTER TABLE personal_labels ADD COLUMN scope text NOT NULL DEFAULT 'personal' CHECK(scope IN ('personal','tenant'));
ALTER TABLE personal_labels ADD COLUMN created_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE personal_labels ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE personal_labels ADD CONSTRAINT label_scope_owner CHECK((scope='personal' AND user_id IS NOT NULL) OR (scope='tenant' AND user_id IS NULL));
ALTER TABLE personal_labels ADD UNIQUE(id,tenant_id);
ALTER TABLE personal_labels DROP CONSTRAINT personal_labels_color_check;
ALTER TABLE personal_labels DISABLE TRIGGER storage_payload_track;
UPDATE personal_labels SET created_by=user_id,color=CASE color
 WHEN 'teal' THEN '#CCFBF1' WHEN 'blue' THEN '#DBEAFE' WHEN 'indigo' THEN '#E0E7FF'
 WHEN 'green' THEN '#DCFCE7' WHEN 'amber' THEN '#FEF9C3' WHEN 'red' THEN '#FEE2E2'
 WHEN 'slate' THEN '#F1F3F5' WHEN 'cyan' THEN '#CFFAFE' END;
ALTER TABLE personal_labels ADD CONSTRAINT label_color_hex CHECK(color ~ '^#[0-9A-F]{6}$');
-- Abort transaction on conflicting legacy names; do not silently merge users' labels.
CREATE UNIQUE INDEX label_personal_name ON personal_labels(tenant_id,user_id,lower(regexp_replace(btrim(name),'\s+',' ','g'))) WHERE scope='personal';
CREATE UNIQUE INDEX label_tenant_name ON personal_labels(tenant_id,lower(regexp_replace(btrim(name),'\s+',' ','g'))) WHERE scope='tenant';
ALTER TABLE thread_personal_labels ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE thread_personal_labels ADD COLUMN applied_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE thread_personal_labels ADD FOREIGN KEY(label_id,tenant_id) REFERENCES personal_labels(id,tenant_id) ON DELETE CASCADE;
ALTER TABLE thread_personal_labels DISABLE TRIGGER storage_payload_track;
UPDATE thread_personal_labels SET applied_by=user_id;
CREATE FUNCTION label_application_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE label_owner uuid; BEGIN
 SELECT user_id INTO label_owner FROM personal_labels WHERE id=NEW.label_id AND tenant_id=NEW.tenant_id;
 IF NOT FOUND OR NEW.user_id IS DISTINCT FROM label_owner THEN RAISE EXCEPTION 'invalid_label_owner'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER label_application_guard BEFORE INSERT OR UPDATE ON thread_personal_labels FOR EACH ROW EXECUTE FUNCTION label_application_owner();

-- Preserve supervisor deletion authority under a correctly named capability.
ALTER TABLE tenant_members DROP CONSTRAINT tenant_members_capabilities_check;
UPDATE tenant_members SET capabilities=array_replace(capabilities,'contacts_visibility','contacts_manage');
UPDATE invitations SET capabilities=array_replace(capabilities,'contacts_visibility','contacts_manage');
ALTER TABLE tenant_members ADD CONSTRAINT tenant_members_capabilities_check CHECK(capabilities <@ ARRAY['rules','assign_others','dashboard','audit','members','contacts_manage']::text[]);

INSERT INTO storage_logical_catalog VALUES
 ('contact_company_links','contacts','tenant_id','{}'),
 ('contact_user_nicknames','contacts','tenant_id','{}'),
 ('directory_legacy','contacts','tenant_id','{}');
UPDATE storage_logical_catalog SET category='rules' WHERE relation_name IN ('personal_labels','thread_personal_labels');
-- Backfill directly, so a pre-existing full quota does not block conversion.
DO $$ DECLARE relation text; keys text; BEGIN
 FOREACH relation IN ARRAY ARRAY['contacts','contact_companies','personal_labels','thread_personal_labels','contact_company_links','contact_user_nicknames','directory_legacy'] LOOP
  SELECT string_agg(a.attname,',' ORDER BY k.ordinality) INTO keys FROM pg_index i
   CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(attnum,ordinality)
   JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=k.attnum
   WHERE i.indrelid=relation::regclass AND i.indisprimary;
  EXECUTE format('DELETE FROM storage_logical_payloads WHERE relation_name=%L',relation);
  EXECUTE format('INSERT INTO storage_logical_payloads SELECT %L,(SELECT jsonb_object_agg(k,to_jsonb(r)->k)::text FROM unnest(string_to_array(%L,'','')) k),r.tenant_id,NULL,c.category,0,octet_length((to_jsonb(r)-c.excluded_columns)::text),(to_jsonb(r)->>''deleted_at'') IS NOT NULL FROM %I r CROSS JOIN storage_logical_catalog c WHERE c.relation_name=%L',relation,keys,relation,relation);
  IF relation IN ('contact_company_links','contact_user_nicknames','directory_legacy') THEN
   EXECUTE format('CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION storage_track_payload(%L,''contacts'',''tenant_id'','''')',relation,keys);
  ELSIF relation IN ('personal_labels','thread_personal_labels') THEN
   EXECUTE format('DROP TRIGGER storage_payload_track ON %I',relation);
   EXECUTE format('CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION storage_track_payload(%L,''rules'',''tenant_id'','''')',relation,keys);
  ELSE EXECUTE format('ALTER TABLE %I ENABLE TRIGGER storage_payload_track',relation); END IF;
 END LOOP;
END $$;
