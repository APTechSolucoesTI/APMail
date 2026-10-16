-- The optimistic UI revision and iTIP SEQUENCE have different lifecycles:
-- changing an exception must not invalidate responses to the series master.
ALTER TABLE calendar_events ADD COLUMN schedule_sequence integer NOT NULL DEFAULT 0 CHECK(schedule_sequence>=0);
UPDATE calendar_events SET schedule_sequence=sequence;
