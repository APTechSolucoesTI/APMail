create table access_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 80),
  description text not null default '' check (length(description)<=300),
  permissions text[] not null default '{}',
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id,id)
);
create unique index access_profiles_name on access_profiles(tenant_id,lower(name));
create trigger access_profiles_updated before update on access_profiles for each row execute function set_updated_at();
alter table tenant_members add column access_profile_id uuid;
alter table tenant_members add constraint tenant_member_profile_fk foreign key (tenant_id,access_profile_id) references access_profiles(tenant_id,id);
alter table tenant_members add constraint profile_only_member check (access_profile_id is null or role='member');
create index tenant_members_profile on tenant_members(tenant_id,access_profile_id) where access_profile_id is not null;
alter table invitations add column access_profile_id uuid;
alter table invitations add constraint invitation_profile_fk foreign key (tenant_id,access_profile_id) references access_profiles(tenant_id,id);
alter table invitations add constraint invitation_profile_member check (access_profile_id is null or tenant_role='member');
create index invitations_profile on invitations(tenant_id,access_profile_id) where access_profile_id is not null;

-- Snapshots survive user renames and soft/persistent message deletion. No credentials or HTML.
alter table audit_logs add column actor_name text;
alter table audit_logs add column actor_email text;
alter table audit_logs add column mailbox_id uuid;
alter table audit_logs add column message_subject text;
alter table audit_logs add column message_content text;
alter table audit_logs add column request_id text;
create index audit_tenant_actor_date on audit_logs(tenant_id,actor_id,created_at desc,id desc);
create index audit_tenant_action_date on audit_logs(tenant_id,action,created_at desc,id desc);
create index audit_tenant_mailbox_date on audit_logs(tenant_id,mailbox_id,created_at desc,id desc) where mailbox_id is not null;
