-- Identities are metadata belonging to the conversation, never retention roots.
ALTER TABLE thread_message_identities DROP CONSTRAINT thread_message_identities_thread_id_fkey;
ALTER TABLE thread_message_identities ADD CONSTRAINT thread_message_identities_thread_id_fkey
 FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE;
