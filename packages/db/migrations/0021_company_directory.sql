-- Extend the existing tenant-owned company table instead of duplicating companies.
ALTER TABLE contact_companies ADD COLUMN addresses jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(addresses)='array');
ALTER TABLE contact_companies ADD COLUMN visibility text NOT NULL DEFAULT 'all' CHECK (visibility IN ('all','selected'));
ALTER TABLE contact_companies ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE contact_companies ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
CREATE TABLE contact_company_mailboxes (
 tenant_id uuid NOT NULL,company_id uuid NOT NULL,mailbox_id uuid NOT NULL,
 PRIMARY KEY(company_id,mailbox_id),
 FOREIGN KEY(tenant_id,company_id) REFERENCES contact_companies(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(tenant_id,mailbox_id) REFERENCES mailboxes(tenant_id,id) ON DELETE CASCADE
);
ALTER TABLE contact_companies DISABLE TRIGGER storage_payload_track;
UPDATE contact_companies cc SET addresses=coalesce((SELECT jsonb_agg(DISTINCT to_jsonb(a)-'id'-'tenant_id') FROM contact_email_links l JOIN contact_addresses a ON a.id=l.address_id AND a.tenant_id=l.tenant_id WHERE l.company_id=cc.id AND l.tenant_id=cc.tenant_id),'[]');
-- Preserve existing restrictions for companies known only through restricted contacts.
UPDATE contact_companies cc SET visibility='selected'
 WHERE EXISTS(SELECT 1 FROM contact_email_links l WHERE l.company_id=cc.id)
 AND NOT EXISTS(SELECT 1 FROM contact_email_links l JOIN contacts c ON c.id=l.contact_id AND c.tenant_id=l.tenant_id WHERE l.company_id=cc.id AND c.visibility='all');
INSERT INTO contact_company_mailboxes(tenant_id,company_id,mailbox_id)
 SELECT DISTINCT cc.tenant_id,cc.id,cm.mailbox_id FROM contact_companies cc JOIN contact_email_links l ON l.company_id=cc.id AND l.tenant_id=cc.tenant_id JOIN contact_mailboxes cm ON cm.contact_id=l.contact_id AND cm.tenant_id=l.tenant_id WHERE cc.visibility='selected';
INSERT INTO storage_logical_catalog VALUES('contact_company_mailboxes','metadata','tenant_id','{}');
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON contact_company_mailboxes FOR EACH ROW EXECUTE FUNCTION storage_track_payload('company_id,mailbox_id','metadata','tenant_id','');
INSERT INTO storage_logical_payloads(relation_name,row_key,tenant_id,mailbox_id,category,metadata_bytes,body_bytes,retained)
 SELECT 'contact_company_mailboxes',jsonb_build_object('company_id',company_id,'mailbox_id',mailbox_id)::text,tenant_id,NULL,'metadata',octet_length(to_jsonb(cm)::text),0,false FROM contact_company_mailboxes cm;
UPDATE storage_logical_payloads p SET metadata_bytes=octet_length((to_jsonb(cc)-catalog.excluded_columns)::text)::bigint FROM contact_companies cc,storage_logical_catalog catalog WHERE catalog.relation_name='contact_companies' AND p.relation_name='contact_companies' AND p.row_key=jsonb_build_object('id',cc.id)::text;
ALTER TABLE contact_companies ENABLE TRIGGER storage_payload_track;
