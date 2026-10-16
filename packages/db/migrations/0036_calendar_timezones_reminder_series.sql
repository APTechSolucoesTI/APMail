ALTER TABLE calendar_events ADD COLUMN timezone_definition text;
ALTER TABLE reminders ADD COLUMN series_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE reminders ADD COLUMN recurrence_index integer NOT NULL DEFAULT 0 CHECK(recurrence_index>=0);
CREATE UNIQUE INDEX reminder_series_occurrence ON reminders(series_id,recurrence_index);
CREATE INDEX calendar_events_calendar_fk ON calendar_events(calendar_id,tenant_id,user_id);
CREATE INDEX calendar_events_mailbox_fk ON calendar_events(mailbox_id,tenant_id) WHERE mailbox_id IS NOT NULL;
CREATE INDEX reminder_event_fk ON reminders(event_id,tenant_id,user_id) WHERE event_id IS NOT NULL;
