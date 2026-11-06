alter table integration_api_tokens alter column expires_at drop not null;
comment on column integration_api_tokens.expires_at is 'NULL indicates an integration key without expiration.';
