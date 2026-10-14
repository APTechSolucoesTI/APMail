-- CHECK constraints accept UNKNOWN; require a sequence explicitly for every series occurrence.
ALTER TABLE outbox DROP CONSTRAINT outbox_recurrence_sequence;
ALTER TABLE outbox ADD CONSTRAINT outbox_recurrence_sequence CHECK (
  (recurrence_id IS NULL AND recurrence_sequence IS NULL)
  OR (recurrence_id IS NOT NULL AND recurrence_sequence IS NOT NULL AND recurrence_sequence >= 1)
);
