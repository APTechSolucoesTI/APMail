-- Previous samples could combine a user's STORAGE resource with a domain root.
-- Invalidate only provider observations, preserving all APMail limits/checkpoints.
UPDATE mailbox_storage_limits
SET provider_status = 'pending', provider_used_bytes = NULL,
    provider_limit_bytes = NULL, provider_identity = NULL, provider_checked_at = NULL;
