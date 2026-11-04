ALTER TABLE user_preferences DROP CONSTRAINT user_preferences_mail_page_size_check;
UPDATE user_preferences SET mail_page_size = 50 WHERE mail_page_size IN (10, 25);
ALTER TABLE user_preferences ALTER COLUMN mail_page_size SET DEFAULT 50;
ALTER TABLE user_preferences ADD CONSTRAINT user_preferences_mail_page_size_check
  CHECK (mail_page_size IN (0, 50, 100, 200));

-- Unknown for receipts already stored. Do not relabel historical receipts on upgrade.
-- New POP3 receipts have no provider Seen flag and start unread in the application.
ALTER TABLE messages ADD COLUMN mdn_provider_seen boolean;
