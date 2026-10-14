-- A purged outbox may leave the consent record until the source message is
-- purged. Keep its decision while the FK sets only outbox_id to null.
ALTER TABLE mdn_decisions DROP CONSTRAINT mdn_decisions_check;
