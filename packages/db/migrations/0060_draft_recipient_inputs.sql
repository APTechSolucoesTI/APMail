-- Preserve unfinished recipient editing without allowing invalid delivery addresses.
ALTER TABLE outbox ADD COLUMN recipient_inputs jsonb NOT NULL
 DEFAULT '{"to":"","cc":"","bcc":""}'::jsonb;
ALTER TABLE outbox ADD CONSTRAINT outbox_recipient_inputs_object
 CHECK (jsonb_typeof(recipient_inputs) = 'object');
