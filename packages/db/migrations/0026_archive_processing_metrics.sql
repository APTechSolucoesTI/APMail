ALTER TABLE mail_archive_imports
  ADD COLUMN analyzed_messages integer NOT NULL DEFAULT 0 CHECK(analyzed_messages >= 0),
  ADD COLUMN expanded_bytes bigint NOT NULL DEFAULT 0 CHECK(expanded_bytes >= 0),
  ADD COLUMN processed_bytes bigint NOT NULL DEFAULT 0 CHECK(processed_bytes >= 0),
  ADD COLUMN added_storage_bytes bigint NOT NULL DEFAULT 0 CHECK(added_storage_bytes >= 0),
  ADD COLUMN analyzed_at timestamptz;

-- Processing counters must remain writable when the tenant is at its quota.
UPDATE storage_logical_catalog SET excluded_columns=excluded_columns ||
  ARRAY['analyzed_messages','expanded_bytes','processed_bytes','added_storage_bytes','analyzed_at']
  WHERE relation_name='mail_archive_imports';
DROP TRIGGER storage_payload_track ON mail_archive_imports;
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON mail_archive_imports
  FOR EACH ROW EXECUTE FUNCTION storage_track_payload('id','metadata','mailbox_id',
  'storage_path,last_error,cursor,imported,skipped,state,updated_at,uploaded_bytes,upload_fingerprint,analyzed_messages,expanded_bytes,processed_bytes,added_storage_bytes,analyzed_at');
