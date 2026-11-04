ALTER TABLE tenants ADD COLUMN mail_retention_days integer NOT NULL DEFAULT 30
  CHECK (mail_retention_days BETWEEN 1 AND 3650);

ALTER TABLE messages
  ADD COLUMN retention_expires_at timestamptz,
  ADD COLUMN retention_deleted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN retention_purge_requested_at timestamptz,
  ADD COLUMN retention_purge_requested_by uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN retention_retry_at timestamptz,
  ADD COLUMN retention_last_error text,
  ADD COLUMN retention_imap_folder_id uuid,
  ADD COLUMN retention_imap_uid bigint,
  ADD COLUMN retention_imap_uidvalidity bigint,
  ADD CONSTRAINT messages_retention_requires_deletion CHECK
    (retention_expires_at IS NULL OR deleted_at IS NOT NULL),
  ADD CONSTRAINT messages_retention_purge_requires_retention CHECK
    (retention_purge_requested_at IS NULL OR retention_expires_at IS NOT NULL);

CREATE INDEX messages_retention_list ON messages(tenant_id, deleted_at DESC, id)
  WHERE retention_expires_at IS NOT NULL;
CREATE INDEX messages_retention_expiry ON messages(retention_expires_at, id)
  WHERE retention_expires_at IS NOT NULL AND NOT pending_action;
CREATE INDEX messages_retention_manual ON messages(retention_purge_requested_at, id)
  WHERE retention_purge_requested_at IS NOT NULL AND NOT pending_action;
CREATE INDEX messages_retention_imap_identity
  ON messages(tenant_id, mailbox_id, retention_imap_folder_id, message_id_header)
  WHERE retention_imap_folder_id IS NOT NULL;

UPDATE access_profiles SET permissions=ARRAY(
  SELECT DISTINCT p FROM unnest(permissions || ARRAY['retention.manage','retention.purge']) p
) WHERE system_role IN ('owner','admin');

CREATE FUNCTION seed_retention_profile_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.system_role IN ('owner','admin') THEN
    NEW.permissions=ARRAY(
      SELECT DISTINCT p FROM unnest(NEW.permissions || ARRAY['retention.manage','retention.purge']) p
    );
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER seed_retention_profile_permissions BEFORE INSERT ON access_profiles
  FOR EACH ROW EXECUTE FUNCTION seed_retention_profile_permissions();
