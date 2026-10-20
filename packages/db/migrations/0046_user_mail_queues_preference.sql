ALTER TABLE user_preferences
  ADD COLUMN mail_queues_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN user_preferences.mail_queues_enabled IS
  'Personal visibility of mail service queues and workflow controls; does not change shared threads or permissions.';
