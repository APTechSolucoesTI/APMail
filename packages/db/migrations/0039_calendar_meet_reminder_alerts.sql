ALTER TABLE calendar_events
 ADD COLUMN description_html text NOT NULL DEFAULT '',
 ADD COLUMN meeting_url text,
 ADD COLUMN availability text NOT NULL DEFAULT 'busy' CHECK (availability IN ('busy','free','tentative','out_of_office'));
ALTER TABLE reminders
 ADD COLUMN alert_owner uuid,
 ADD COLUMN alert_lease_until timestamptz;
CREATE INDEX reminder_alerts ON reminders(tenant_id,user_id,alert_lease_until,due_at) WHERE status='notified';
