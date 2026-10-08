ALTER TABLE mailboxes ADD COLUMN receiving_protocol text NOT NULL DEFAULT 'imap' CHECK(receiving_protocol IN ('imap','pop3','local'));
ALTER TABLE messages ADD COLUMN source_kind text NOT NULL DEFAULT 'imap' CHECK(source_kind IN ('imap','pop3','archive'));
ALTER TABLE messages ADD COLUMN source_key text;
ALTER TABLE messages ADD COLUMN raw_storage_path text;
ALTER TABLE folders ADD COLUMN is_local boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX message_external_source ON messages(tenant_id,mailbox_id,source_kind,source_key) WHERE source_key IS NOT NULL;
CREATE TABLE mail_archive_imports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,mailbox_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),filename text NOT NULL,format text NOT NULL CHECK(format IN ('pst','ost','mbox','eml','emlx','zip')),
 size_bytes bigint NOT NULL CHECK(size_bytes>0),storage_path text,
 state text NOT NULL DEFAULT 'uploading' CHECK(state IN ('uploading','queued','running','paused','completed','failed','cancelled')),
 cursor integer NOT NULL DEFAULT 0,imported integer NOT NULL DEFAULT 0,skipped integer NOT NULL DEFAULT 0,
 last_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(mailbox_id,tenant_id) REFERENCES mailboxes(id,tenant_id)
);
CREATE INDEX mail_archive_tasks ON mail_archive_imports(tenant_id,mailbox_id,created_at DESC);
CREATE FUNCTION storage_mail_archive_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE path text; asset uuid; row jsonb;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN DELETE FROM storage_asset_refs WHERE source_kind=TG_TABLE_NAME||'_raw' AND source_id=OLD.id; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 row=to_jsonb(NEW);path=CASE TG_TABLE_NAME WHEN 'messages' THEN row->>'raw_storage_path' ELSE row->>'storage_path' END;
 IF path IS NULL THEN RETURN NEW; END IF;
 INSERT INTO storage_assets(storage_key,scope,tenant_id,mailbox_id,category,expected_bytes)
 VALUES(path,'mailbox',NEW.tenant_id,NEW.mailbox_id,CASE TG_TABLE_NAME WHEN 'messages' THEN 'mail_raw' ELSE 'mail_import' END,(row->>'size_bytes')::bigint)
 ON CONFLICT(storage_key) DO UPDATE SET updated_at=now(),revision=storage_assets.revision+1 RETURNING id INTO asset;
 INSERT INTO storage_asset_refs(source_kind,source_id,asset_id,tenant_id,mailbox_id) VALUES(TG_TABLE_NAME||'_raw',NEW.id,asset,NEW.tenant_id,NEW.mailbox_id);
 RETURN NEW;
END $$;
CREATE TRIGGER message_raw_ref AFTER INSERT OR UPDATE OF raw_storage_path OR DELETE ON messages FOR EACH ROW EXECUTE FUNCTION storage_mail_archive_reference();
CREATE TRIGGER mail_import_ref AFTER INSERT OR UPDATE OF storage_path OR DELETE ON mail_archive_imports FOR EACH ROW EXECUTE FUNCTION storage_mail_archive_reference();
INSERT INTO storage_logical_catalog VALUES('mail_archive_imports','metadata','mailbox_id',ARRAY['storage_path','last_error','cursor','imported','skipped','state','updated_at']);
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON mail_archive_imports FOR EACH ROW EXECUTE FUNCTION storage_track_payload('id','metadata','mailbox_id','storage_path,last_error,cursor,imported,skipped,state,updated_at');
-- Refresh changed metadata without enforcing pre-existing full quotas during upgrade.
ALTER TABLE mailboxes DISABLE TRIGGER storage_payload_track;
ALTER TABLE messages DISABLE TRIGGER storage_payload_track;
ALTER TABLE folders DISABLE TRIGGER storage_payload_track;
DO $$ DECLARE rel text; BEGIN FOREACH rel IN ARRAY ARRAY['mailboxes','messages','folders'] LOOP
 EXECUTE format('DELETE FROM storage_logical_payloads WHERE relation_name=%L',rel);
 EXECUTE format('INSERT INTO storage_logical_payloads SELECT %L,jsonb_build_object(''id'',r.id)::text,r.tenant_id,CASE WHEN c.owner_column=''mailbox_id'' THEN (to_jsonb(r)->>''mailbox_id'')::uuid ELSE NULL END,c.category,CASE WHEN %L=''messages'' THEN octet_length(coalesce(to_jsonb(r)->>''body_html'','''')||coalesce(to_jsonb(r)->>''body_text'','''')) ELSE 0 END,octet_length((to_jsonb(r)-c.excluded_columns)::text),(to_jsonb(r)->>''deleted_at'') IS NOT NULL FROM %I r JOIN storage_logical_catalog c ON c.relation_name=%L',rel,rel,rel,rel);
 END LOOP; END $$;
ALTER TABLE mailboxes ENABLE TRIGGER storage_payload_track;
ALTER TABLE messages ENABLE TRIGGER storage_payload_track;
ALTER TABLE folders ENABLE TRIGGER storage_payload_track;
