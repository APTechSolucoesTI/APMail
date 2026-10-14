ALTER TABLE threads ADD COLUMN is_pinned_global boolean NOT NULL DEFAULT false;

CREATE TABLE mail_schedule_series (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, mailbox_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),
 unit text NOT NULL CHECK(unit IN ('hour','day','week','month')),
 interval integer NOT NULL CHECK(interval BETWEEN 1 AND 365),
 timezone text NOT NULL, starts_at timestamptz NOT NULL, end_at timestamptz,
 max_occurrences integer CHECK(max_occurrences BETWEEN 1 AND 10000),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','completed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(id,tenant_id,mailbox_id), CHECK(end_at IS NULL OR end_at>=starts_at),
 FOREIGN KEY(mailbox_id,tenant_id) REFERENCES mailboxes(id,tenant_id) ON DELETE CASCADE
);
ALTER TABLE outbox ADD COLUMN recurrence_id uuid, ADD COLUMN recurrence_sequence integer;
ALTER TABLE outbox ADD CONSTRAINT outbox_recurrence_scope FOREIGN KEY(recurrence_id,tenant_id,mailbox_id)
 REFERENCES mail_schedule_series(id,tenant_id,mailbox_id);
ALTER TABLE outbox ADD CONSTRAINT outbox_recurrence_sequence CHECK(
 (recurrence_id IS NULL AND recurrence_sequence IS NULL) OR (recurrence_id IS NOT NULL AND recurrence_sequence>=1)
);
CREATE UNIQUE INDEX outbox_recurrence_occurrence ON outbox(recurrence_id,recurrence_sequence) WHERE recurrence_id IS NOT NULL;
CREATE INDEX mail_schedule_series_active ON mail_schedule_series(tenant_id,mailbox_id) WHERE state='active';
CREATE INDEX outbox_recurrence_recovery ON outbox(recurrence_id,recurrence_sequence DESC) WHERE recurrence_id IS NOT NULL AND status='sent';
INSERT INTO storage_logical_catalog VALUES('mail_schedule_series','metadata','mailbox_id',ARRAY['state','updated_at']);
CREATE TRIGGER storage_payload_track AFTER INSERT OR UPDATE OR DELETE ON mail_schedule_series FOR EACH ROW
 EXECUTE FUNCTION storage_track_payload('id','metadata','mailbox_id','state,updated_at');
