ALTER TABLE mail_archive_imports ADD COLUMN uploaded_bytes bigint NOT NULL DEFAULT 0 CHECK(uploaded_bytes >= 0 AND uploaded_bytes <= size_bytes);
ALTER TABLE mail_archive_imports ADD COLUMN upload_fingerprint text CHECK(upload_fingerprint IS NULL OR upload_fingerprint ~ '^[a-f0-9]{64}$');
-- Upload checkpoints are operational metadata, like the processing cursor. Updating them
-- must not consume additional logical quota when a tenant is already full.
UPDATE storage_logical_catalog SET excluded_columns=excluded_columns || ARRAY['uploaded_bytes','upload_fingerprint'] WHERE relation_name='mail_archive_imports';
DROP TRIGGER storage_payload_track ON mail_archive_imports;
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON mail_archive_imports FOR EACH ROW EXECUTE FUNCTION storage_track_payload('id','metadata','mailbox_id','storage_path,last_error,cursor,imported,skipped,state,updated_at,uploaded_bytes,upload_fingerprint');
-- A legacy processing failure retained its completely uploaded source and remains resumable.
UPDATE mail_archive_imports SET uploaded_bytes=size_bytes WHERE state IN ('queued','running','paused','completed') OR (state='failed' AND storage_path IS NOT NULL);
