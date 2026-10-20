-- Account authentication is global: the same identity can belong to multiple tenants.
-- These tables are private to the authenticated server; no secret is returned by /auth/me.
create table user_two_factor (
  user_id uuid primary key references users(id) on delete cascade,
  encrypted_secret text,
  enabled_at timestamptz,
  last_used_step bigint not null default -1,
  recovery_code_hashes text[] not null default '{}',
  pending_encrypted_secret text,
  pending_expires_at timestamptz,
  version uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((encrypted_secret is null) = (enabled_at is null)),
  check ((pending_encrypted_secret is null) = (pending_expires_at is null)),
  check (cardinality(recovery_code_hashes) <= 10)
);
create trigger user_two_factor_updated before update on user_two_factor
  for each row execute function set_updated_at();

create table auth_two_factor_challenges (
  token_hash text primary key check (length(token_hash) = 64),
  user_id uuid not null references users(id) on delete cascade,
  factor_version uuid not null,
  password_fingerprint text not null check (length(password_fingerprint) = 64),
  attempts smallint not null default 0 check (attempts between 0 and 5),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index auth_two_factor_challenges_user on auth_two_factor_challenges(user_id);
create index auth_two_factor_challenges_expiry on auth_two_factor_challenges(expires_at);
