-- A NULL lower boundary imports all messages without an IMAP SINCE filter.
-- Existing mailboxes and the 90-day default remain unchanged.
ALTER TABLE mailboxes ALTER COLUMN sync_since DROP NOT NULL;
COMMENT ON COLUMN mailboxes.sync_since IS
  'Initial IMAP import lower date boundary; NULL imports all available history.';
