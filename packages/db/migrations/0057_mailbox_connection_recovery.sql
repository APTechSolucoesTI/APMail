-- Durable recovery survives worker/queue restarts. Disabled mailboxes stay disabled.
ALTER TABLE mailboxes
 ADD COLUMN connection_failures integer NOT NULL DEFAULT 0 CHECK(connection_failures >= 0),
 ADD COLUMN connection_revision integer NOT NULL DEFAULT 0 CHECK(connection_revision >= 0),
 ADD COLUMN connection_error_kind text CHECK(connection_error_kind IN ('transient','authentication','security')),
 ADD COLUMN connection_failed_at timestamptz,
 ADD COLUMN connection_alerted_at timestamptz,
 ADD COLUMN next_connection_attempt_at timestamptz;
CREATE INDEX mailboxes_connection_recovery ON mailboxes(next_connection_attempt_at,id)
 WHERE deleted_at IS NULL AND status IN ('pending','error');
