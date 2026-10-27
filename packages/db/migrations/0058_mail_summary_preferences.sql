-- Keep legacy queue visibility intact; its individual control is retired.
ALTER TABLE user_preferences
  ADD COLUMN mail_page_size integer NOT NULL DEFAULT 10
    CHECK (mail_page_size IN (10,25,50,100)),
  ADD COLUMN mail_summary_enabled boolean NOT NULL DEFAULT false;
