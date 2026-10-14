CREATE TABLE mail_archive_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL, mailbox_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 filename text NOT NULL, format text NOT NULL DEFAULT 'pst' CHECK(format='pst'),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','staging','converting','ready','failed','cancelled','expired')),
 include_deleted boolean NOT NULL DEFAULT false, folder_id uuid,
 cutoff_at timestamptz NOT NULL DEFAULT now(), last_message_id uuid,
 total_messages integer NOT NULL DEFAULT 0 CHECK(total_messages>=0),
 prepared integer NOT NULL DEFAULT 0 CHECK(prepared>=0), converted integer NOT NULL DEFAULT 0 CHECK(converted>=0),
 warnings integer NOT NULL DEFAULT 0 CHECK(warnings>=0), last_error text,
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id,mailbox_id),
 FOREIGN KEY(mailbox_id,tenant_id) REFERENCES mailboxes(id,tenant_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX mail_archive_export_active ON mail_archive_exports(tenant_id,mailbox_id) WHERE state IN ('queued','staging','converting');
CREATE INDEX mail_archive_export_tasks ON mail_archive_exports(tenant_id,mailbox_id,created_at DESC);
CREATE INDEX mail_archive_export_expiry ON mail_archive_exports(expires_at) WHERE state IN ('ready','failed','cancelled');
CREATE TABLE mail_archive_export_files (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), export_id uuid NOT NULL, tenant_id uuid NOT NULL, mailbox_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('source','pst')), folder_id uuid, folder_path text[] NOT NULL DEFAULT '{}',
 filename text NOT NULL, storage_path text NOT NULL UNIQUE, size_bytes bigint NOT NULL DEFAULT 0 CHECK(size_bytes>=0),
 FOREIGN KEY(export_id,tenant_id,mailbox_id) REFERENCES mail_archive_exports(id,tenant_id,mailbox_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX mail_archive_export_source_folder ON mail_archive_export_files(export_id,folder_id) NULLS NOT DISTINCT WHERE kind='source';
CREATE FUNCTION storage_mail_export_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE asset uuid;
BEGIN
 IF TG_OP IN ('UPDATE','DELETE') THEN DELETE FROM storage_asset_refs WHERE source_kind=TG_TABLE_NAME AND source_id=OLD.id; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 INSERT INTO storage_assets(storage_key,scope,tenant_id,mailbox_id,category,expected_bytes)
 VALUES(NEW.storage_path,'mailbox',NEW.tenant_id,NEW.mailbox_id,'mail_export',NEW.size_bytes)
 ON CONFLICT(storage_key) DO UPDATE SET updated_at=now(),revision=storage_assets.revision+1 RETURNING id INTO asset;
 INSERT INTO storage_asset_refs(source_kind,source_id,asset_id,tenant_id,mailbox_id) VALUES(TG_TABLE_NAME,NEW.id,asset,NEW.tenant_id,NEW.mailbox_id);
 RETURN NEW;
END $$;
CREATE TRIGGER mail_export_ref AFTER INSERT OR UPDATE OF storage_path OR DELETE ON mail_archive_export_files FOR EACH ROW EXECUTE FUNCTION storage_mail_export_reference();
INSERT INTO storage_logical_catalog VALUES('mail_archive_exports','metadata','mailbox_id',ARRAY['state','prepared','converted','warnings','last_error','last_message_id','total_messages','updated_at','expires_at']);
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON mail_archive_exports FOR EACH ROW EXECUTE FUNCTION storage_track_payload('id','metadata','mailbox_id','state,prepared,converted,warnings,last_error,last_message_id,total_messages,updated_at,expires_at');
INSERT INTO storage_logical_catalog VALUES('mail_archive_export_files','metadata','mailbox_id',ARRAY['size_bytes']);
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON mail_archive_export_files FOR EACH ROW EXECUTE FUNCTION storage_track_payload('id','metadata','mailbox_id','size_bytes');
