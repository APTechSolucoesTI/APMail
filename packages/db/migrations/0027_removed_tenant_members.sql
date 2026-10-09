-- Keep the membership identity for contact ownership, chat history and audit.
-- A removed membership has no access and only a new invitation can restore it.
ALTER TYPE member_status ADD VALUE IF NOT EXISTS 'removed';
