-- Preserve existing contacts and establish deterministic primary channels.
ALTER TABLE contacts ADD COLUMN job_title text NOT NULL DEFAULT '' CHECK (length(job_title) <= 120);
ALTER TABLE contacts ADD COLUMN phones jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(phones) = 'array' AND jsonb_array_length(phones) <= 100);
ALTER TABLE contact_emails ADD COLUMN is_primary boolean NOT NULL DEFAULT false;
ALTER TABLE contact_email_links ADD COLUMN contact_id uuid;
ALTER TABLE contact_email_links ADD COLUMN is_primary_company boolean NOT NULL DEFAULT false;

-- Backfill must not be refused by a previously configured content quota.
ALTER TABLE contacts DISABLE TRIGGER storage_payload_track;
ALTER TABLE contact_emails DISABLE TRIGGER storage_payload_track;
ALTER TABLE contact_email_links DISABLE TRIGGER storage_payload_track;
UPDATE contacts SET phones = jsonb_build_array(jsonb_build_object('number',phone,'label','','is_primary',true)) WHERE trim(phone) <> '';
WITH ranked AS (SELECT id,row_number() OVER (PARTITION BY contact_id ORDER BY email,id) AS n FROM contact_emails)
UPDATE contact_emails e SET is_primary = r.n=1 FROM ranked r WHERE r.id=e.id;
UPDATE contact_email_links l SET contact_id=e.contact_id FROM contact_emails e WHERE e.id=l.email_id AND e.tenant_id=l.tenant_id;
WITH ranked AS (SELECT l.id,row_number() OVER (PARTITION BY l.contact_id ORDER BY e.is_primary DESC,e.email,l.id) AS n FROM contact_email_links l JOIN contact_emails e ON e.id=l.email_id WHERE l.company_id IS NOT NULL)
UPDATE contact_email_links l SET is_primary_company=r.n=1 FROM ranked r WHERE r.id=l.id;

ALTER TABLE contact_email_links ALTER COLUMN contact_id SET NOT NULL;
ALTER TABLE contact_email_links ADD CONSTRAINT primary_company_present CHECK (NOT is_primary_company OR company_id IS NOT NULL);
ALTER TABLE contact_emails ADD CONSTRAINT contact_email_parent_key UNIQUE(tenant_id,contact_id,id);
ALTER TABLE contact_email_links ADD CONSTRAINT contact_link_parent_fk FOREIGN KEY(tenant_id,contact_id,email_id) REFERENCES contact_emails(tenant_id,contact_id,id) ON DELETE CASCADE;
CREATE UNIQUE INDEX contact_primary_email ON contact_emails(contact_id) WHERE is_primary;
CREATE UNIQUE INDEX contact_primary_company ON contact_email_links(contact_id) WHERE is_primary_company;

-- Refresh canonical payload for the new columns, without inventing a disk charge.
UPDATE storage_logical_payloads p SET metadata_bytes=octet_length((to_jsonb(c)-catalog.excluded_columns)::text)::bigint FROM contacts c,storage_logical_catalog catalog WHERE catalog.relation_name='contacts' AND p.relation_name='contacts' AND p.row_key=jsonb_build_object('id',c.id)::text;
UPDATE storage_logical_payloads p SET metadata_bytes=octet_length((to_jsonb(c)-catalog.excluded_columns)::text)::bigint FROM contact_emails c,storage_logical_catalog catalog WHERE catalog.relation_name='contact_emails' AND p.relation_name='contact_emails' AND p.row_key=jsonb_build_object('id',c.id)::text;
UPDATE storage_logical_payloads p SET metadata_bytes=octet_length((to_jsonb(c)-catalog.excluded_columns)::text)::bigint FROM contact_email_links c,storage_logical_catalog catalog WHERE catalog.relation_name='contact_email_links' AND p.relation_name='contact_email_links' AND p.row_key=jsonb_build_object('id',c.id)::text;
ALTER TABLE contacts ENABLE TRIGGER storage_payload_track;
ALTER TABLE contact_emails ENABLE TRIGGER storage_payload_track;
ALTER TABLE contact_email_links ENABLE TRIGGER storage_payload_track;
