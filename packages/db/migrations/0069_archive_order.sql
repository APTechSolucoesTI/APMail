-- Existing tasks retain their read-state behavior; only future imports default to read.
ALTER TABLE mail_archive_imports
  ADD COLUMN folder_order text NOT NULL DEFAULT 'original'
    CHECK (folder_order IN ('original', 'alphabetical')),
  ADD COLUMN mark_read boolean NOT NULL DEFAULT false,
  ADD COLUMN folder_manifest jsonb CHECK (folder_manifest IS NULL OR jsonb_typeof(folder_manifest) = 'array');
ALTER TABLE mail_archive_imports ALTER COLUMN mark_read SET DEFAULT true;
