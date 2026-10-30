-- Keep the original MIME and source identity for audit/rollback while allowing a
-- repaired reconstruction to deduplicate and export from the recovered content.
ALTER TABLE messages ADD COLUMN archive_reconstructed_key text
  CHECK (archive_reconstructed_key IS NULL OR archive_reconstructed_key ~ '^[0-9a-f]{64}$');
CREATE INDEX messages_archive_reconstructed_key ON messages(tenant_id,mailbox_id,archive_reconstructed_key)
  WHERE source_kind='archive' AND archive_reconstructed_key IS NOT NULL;
COMMENT ON COLUMN messages.archive_reconstructed_key IS
  'SHA256 of corrected PST MIME. Original source_key/raw MIME are retained; exports reconstruct recovered bodies with existing verified attachments.';
