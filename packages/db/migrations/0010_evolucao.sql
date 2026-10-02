alter table tenants add column suspended_at timestamptz;
alter table tenant_members add column capabilities text[] not null default '{}'
  check (capabilities <@ array['rules','assign_others','dashboard','audit','members','contacts_visibility']::text[]);
alter table invitations add column capabilities text[] not null default '{}';
alter table invitations add column sender_mailbox_id uuid;
alter table invitations add column sender_context text not null default 'legacy' check(sender_context in ('legacy','tenant','platform'));
alter table invitations add column delivery_status text not null default 'pending' check(delivery_status in ('pending','sent','failed'));
alter table invitations add column delivery_error text;
alter table invitations add constraint invitation_sender_fk foreign key (tenant_id,sender_mailbox_id) references mailboxes(tenant_id,id);
alter table mailboxes add column history_classify_days int not null default 0 check(history_classify_days between 0 and 90);
alter table mailboxes add column import_started_at timestamptz;
alter table threads add column history_queue_eligible boolean not null default true;
alter table messages add column is_historical boolean not null default false;
alter table folders add column initial_uid_end bigint;
alter table folders add column special_use_official boolean not null default false;
alter table user_preferences alter column theme set default 'light';
alter table user_preferences alter column density set default 'compact';
alter table user_preferences alter column load_remote_images set default true;
update user_preferences set theme=case when theme='system' then 'light' else theme end,
 density='compact', notify_mentions=true,notify_assignments=true,notify_chat=true,
 desktop_notifications=false,load_remote_images=true;

create table contacts (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),
 name text not null check(length(trim(name)) between 2 and 120),phone text not null default '',notes text not null default '',
 visibility text not null default 'all' check(visibility in ('all','selected')),
 created_by uuid not null references users(id),created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(tenant_id,id)
);
create table contact_emails (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),contact_id uuid not null,
 email text not null check(email=lower(trim(email))),label text not null default '',
 unique(tenant_id,email),unique(tenant_id,id),foreign key(tenant_id,contact_id) references contacts(tenant_id,id) on delete cascade
);
create table contact_companies (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),
 name text not null,trade_name text not null default '',cnpj text,source text,queried_at timestamptz,
 unique(tenant_id,id),unique(tenant_id,cnpj)
);
create table contact_addresses (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),
 cep text not null default '',street text not null default '',number text not null default '',complement text not null default '',
 district text not null default '',city text not null default '',state text not null default '',country text not null default 'Brasil',unique(tenant_id,id)
);
create table contact_email_links (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),email_id uuid not null,
 company_id uuid,address_id uuid,label text not null default '',check(company_id is not null or address_id is not null),
 foreign key(tenant_id,email_id) references contact_emails(tenant_id,id) on delete cascade,
 foreign key(tenant_id,company_id) references contact_companies(tenant_id,id),
 foreign key(tenant_id,address_id) references contact_addresses(tenant_id,id)
);
create table contact_mailboxes (
 tenant_id uuid not null,contact_id uuid not null,mailbox_id uuid not null,primary key(contact_id,mailbox_id),
 foreign key(tenant_id,contact_id) references contacts(tenant_id,id) on delete cascade,
 foreign key(tenant_id,mailbox_id) references mailboxes(tenant_id,id) on delete cascade
);
create index on contacts(tenant_id,lower(name));
create index on contact_emails(tenant_id,contact_id);
create index on contact_email_links(tenant_id,email_id);
create table signature_images (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references tenants(id),user_id uuid not null references users(id),
 storage_path text not null,content_type text not null,width int not null,height int not null,size_bytes int not null,
 created_at timestamptz not null default now()
);
create table platform_admins (user_id uuid primary key references users(id),created_at timestamptz not null default now());
create table platform_audit (
 id uuid primary key default gen_random_uuid(),actor_id uuid not null references users(id),tenant_id uuid references tenants(id),
 action text not null,metadata jsonb not null default '{}',request_id text,created_at timestamptz not null default now()
);
create index on platform_audit(created_at desc);
create table support_sessions (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references platform_admins(user_id) on delete cascade,
 session_hash text not null references sessions(token_hash) on delete cascade,tenant_id uuid not null references tenants(id),
 reason text not null check(length(trim(reason)) between 10 and 500),expires_at timestamptz not null,ended_at timestamptz,
 created_at timestamptz not null default now()
);
create unique index on support_sessions(session_hash) where ended_at is null;
create table operational_logs (
 id bigserial primary key,tenant_id uuid references tenants(id),service text not null,
 level text not null,message text not null,request_id text,metadata jsonb not null default '{}',created_at timestamptz not null default now()
);
create index on operational_logs(created_at desc);
