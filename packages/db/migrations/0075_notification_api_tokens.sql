create table integration_api_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check(length(trim(name)) between 1 and 100),
  token_hash text not null unique check(length(token_hash)=64),
  permission text not null default 'notifications:read' check(permission='notifications:read'),
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  unique(tenant_id,id),
  check(expires_at>created_at)
);
create index integration_api_tokens_tenant_idx on integration_api_tokens(tenant_id,created_at desc);

create table integration_api_token_users (
  tenant_id uuid not null,
  token_id uuid not null,
  user_id uuid not null,
  primary key(tenant_id,token_id,user_id),
  foreign key(tenant_id,token_id) references integration_api_tokens(tenant_id,id) on delete cascade,
  foreign key(tenant_id,user_id) references tenant_members(tenant_id,user_id) on delete cascade
);
