ALTER TYPE mailbox_role ADD VALUE IF NOT EXISTS 'supervisor';

ALTER TABLE mailboxes
  ADD COLUMN box_type text NOT NULL DEFAULT 'global' CHECK (box_type IN ('individual','global')),
  ADD COLUMN queues_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN owner_user_id uuid;
UPDATE mailboxes b SET queues_enabled = COALESCE((t.settings->>'mail_queues_enabled')::boolean,true)
  FROM tenants t WHERE t.id=b.tenant_id;
ALTER TABLE mailboxes ADD CONSTRAINT mailboxes_owner_tenant_member_fk
  FOREIGN KEY (tenant_id,owner_user_id) REFERENCES tenant_members(tenant_id,user_id)
  DEFERRABLE INITIALLY DEFERRED;
CREATE INDEX mailboxes_individual_owner ON mailboxes(tenant_id,owner_user_id)
  WHERE box_type='individual' AND deleted_at IS NULL;
COMMENT ON COLUMN mailboxes.owner_user_id IS 'One existing active send-capable member owns an individual mailbox; never grants membership.';
COMMENT ON COLUMN mailboxes.queues_enabled IS 'Controls service queue presentation only; service remains available when hidden.';

UPDATE tenants SET settings=jsonb_set(settings,'{restrict_operators_to_assigned}','false')
  WHERE NOT settings ? 'restrict_operators_to_assigned';
ALTER TABLE threads ADD COLUMN service_started_at timestamptz;
-- Preserve real historical in-progress state without treating future assignment as service start.
UPDATE threads SET service_started_at=COALESCE(assigned_at,queue_status_changed_at,updated_at,created_at)
  WHERE queue_status='in_progress';
COMMENT ON COLUMN threads.service_started_at IS 'Explicit service start (button/draft); assignment and reading do not start service.';

-- Deferred validation permits inserting members and transferring ownership atomically.
-- All membership/profile mutations must retain one eligible owner in the same company.
CREATE FUNCTION check_individual_mailbox_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_tenant uuid;
BEGIN
  target_tenant := CASE WHEN TG_OP='DELETE' THEN OLD.tenant_id ELSE NEW.tenant_id END;
  PERFORM 1 FROM tenants WHERE id=target_tenant FOR UPDATE;
  IF EXISTS (
    SELECT 1 FROM mailboxes b
    WHERE b.tenant_id=target_tenant AND b.box_type='individual' AND b.deleted_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM tenant_members tm
      JOIN mailbox_members mm ON mm.tenant_id=tm.tenant_id AND mm.user_id=tm.user_id AND mm.mailbox_id=b.id
      LEFT JOIN access_profiles ap ON ap.id=tm.access_profile_id AND ap.tenant_id=tm.tenant_id
      WHERE tm.tenant_id=b.tenant_id AND tm.user_id=b.owner_user_id AND tm.status='active'
        AND mm.role::text IN ('editor','supervisor','mailbox_admin')
        AND (
          (tm.access_profile_id IS NULL AND tm.custom_permissions IS NULL)
          OR (COALESCE(tm.custom_permissions,ap.permissions,'{}'::text[]) @> ARRAY['mail','mail.send'])
        )
    )
  ) THEN
    RAISE EXCEPTION 'Individual mailbox requires an active send-capable owner from the same company'
      USING ERRCODE='23514', CONSTRAINT='individual_mailbox_owner';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER individual_mailbox_owner_on_box AFTER INSERT OR UPDATE ON mailboxes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_individual_mailbox_owner();
CREATE CONSTRAINT TRIGGER individual_mailbox_owner_on_grant AFTER INSERT OR UPDATE OR DELETE ON mailbox_members
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_individual_mailbox_owner();
CREATE CONSTRAINT TRIGGER individual_mailbox_owner_on_member AFTER INSERT OR UPDATE OR DELETE ON tenant_members
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_individual_mailbox_owner();
CREATE CONSTRAINT TRIGGER individual_mailbox_owner_on_profile AFTER UPDATE OR DELETE ON access_profiles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_individual_mailbox_owner();
