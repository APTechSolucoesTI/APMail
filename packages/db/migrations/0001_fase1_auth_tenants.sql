create extension if not exists pgcrypto;
create extension if not exists unaccent;
create extension if not exists pg_trgm;

create type tenant_role        as enum ('owner','admin','member');
create type member_status      as enum ('active','disabled');
create type mailbox_role       as enum ('mailbox_admin','editor','viewer');
create type mailbox_status     as enum ('pending','active','error','disabled');
create type folder_special_use as enum ('inbox','sent','drafts','trash','junk','archive');
create type message_direction  as enum ('inbound','outbound');
create type queue_status       as enum ('none','to_reply','in_progress','awaiting_reply','scheduled','done');
create type outbox_kind        as enum ('new','reply','reply_all','forward');
create type outbox_status      as enum ('draft','queued','scheduled','sending','sent','failed','canceled');
create type mail_action_type   as enum ('move','delete','restore','set_flag','create_folder','rename_folder','delete_folder');
create type job_status         as enum ('pending','processing','done','failed');
create type rule_scope         as enum ('mailbox','personal');
create type chat_type          as enum ('direct','group');
create type notification_type  as enum ('mention','assignment','chat_message','send_failed','mailbox_error','action_failed');

create or replace function set_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

create or replace function enforce_tenant_from_mailbox() returns trigger
language plpgsql as $$
begin
  select m.tenant_id into new.tenant_id from mailboxes m where m.id = new.mailbox_id;
  if new.tenant_id is null then raise exception 'mailbox inexistente'; end if;
  return new;
end $$;
-- enforce_tenant_from_thread() e enforce_tenant_from_conversation(): mesmo padrão com threads/chat_conversations.

create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  password_hash text not null,                    -- Argon2id
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  avatar_path text,                               -- relativo ao STORAGE_DIR
  current_tenant_id uuid,                         -- FK adicionada após criar tenants
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,                -- sha256(token) em hex
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index on sessions (user_id);

create table password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,                -- 1 hora
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 2 and 120),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  timezone text not null default 'America/Sao_Paulo',
  settings jsonb not null default jsonb_build_object(
    'max_attachment_mb', 25,
    'sla_first_response_hours', 24,
    'default_sync_days', 90,
    'allow_external_auto_forward', false
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
alter table users add constraint users_current_tenant_fk foreign key (current_tenant_id) references tenants(id);

create table tenant_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id) on delete cascade,
  role tenant_role not null default 'member',
  status member_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index on tenant_members (user_id);

create table invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  email text not null check (email = lower(email)),
  token_hash text not null unique,
  tenant_role tenant_role not null default 'member' check (tenant_role <> 'owner'),
  mailbox_roles jsonb not null default '[]',      -- [{ "mailbox_id": uuid, "role": "editor" }]
  invited_by uuid not null references users(id),
  expires_at timestamptz not null,                -- 7 dias
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index invitations_pending_uq on invitations (tenant_id, email) where accepted_at is null and revoked_at is null;

create table user_preferences (
  user_id uuid primary key references users(id) on delete cascade,
  theme text not null default 'system' check (theme in ('light','dark','system')),
  density text not null default 'comfortable' check (density in ('comfortable','compact')),
  timezone text not null default 'America/Sao_Paulo',
  notify_mentions boolean not null default true,
  notify_assignments boolean not null default true,
  notify_chat boolean not null default true,
  desktop_notifications boolean not null default false,
  load_remote_images boolean not null default false,
  updated_at timestamptz not null default now()
);

create table table_preferences (
  user_id uuid not null references users(id) on delete cascade,
  list_key text not null,
  config jsonb not null,                          -- { visible: string[], order: string[], pageSize: number }
  updated_at timestamptz not null default now(),
  primary key (user_id, list_key)
);

create table mailboxes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check (length(trim(name)) between 2 and 80),
  email_address text not null check (email_address = lower(email_address)),
  aliases text[] not null default '{}',
  from_name_template text not null default '{mailbox_name}',
  imap_host text not null,
  imap_port int not null default 993,
  imap_secure boolean not null default true,
  smtp_host text not null,
  smtp_port int not null default 465,
  smtp_secure boolean not null default true,        -- true = TLS implícito (465); false = STARTTLS (587) ou texto puro em dev
  username text not null,
  append_sent_copy boolean not null default true,
  sync_since date not null default (current_date - 90),
  status mailbox_status not null default 'pending',
  last_error text,
  last_synced_at timestamptz,
  last_reconciled_at timestamptz,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index mailboxes_tenant_email_uq on mailboxes (tenant_id, email_address) where deleted_at is null;

create table mailbox_credentials (
  mailbox_id uuid primary key references mailboxes(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  encrypted_password text not null,                 -- "v1:<iv_b64>:<authTag_b64>:<ciphertext_b64>"
  updated_at timestamptz not null default now()
);

create table mailbox_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role mailbox_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mailbox_id, user_id)
);
create index on mailbox_members (user_id);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id) on delete cascade,
  type notification_type not null,
  title text not null,
  body text not null default '',
  link text,                                        -- rota interna do SPA, ex.: /mail/<mailbox>?thread=<id>
  payload jsonb not null default '{}',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications (user_id, created_at desc);

create table audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references tenants(id),
  actor_id uuid references users(id),               -- null = sistema/worker
  action text not null,
  entity_type text not null,
  entity_id uuid,
  metadata jsonb not null default '{}',
  ip text,
  created_at timestamptz not null default now()
);
create index on audit_logs (tenant_id, created_at desc);


create or replace function protect_last_owner() returns trigger language plpgsql as $$
begin
 perform 1 from tenants where id=old.tenant_id for update;
 if old.role='owner' and old.status='active' and (TG_OP='DELETE' or new.role<>'owner' or new.status<>'active') then
  if not exists(select 1 from tenant_members where tenant_id=old.tenant_id and id<>old.id and role='owner' and status='active') then raise exception 'last_owner'; end if;
 end if;
 if TG_OP='DELETE' then return old; end if; return new;
end $$;
create trigger protect_last_owner before update or delete on tenant_members for each row execute function protect_last_owner();
create trigger mailbox_credentials_tenant before insert or update on mailbox_credentials for each row execute function enforce_tenant_from_mailbox();
create trigger mailbox_members_tenant before insert or update on mailbox_members for each row execute function enforce_tenant_from_mailbox();
create trigger users_updated before update on users for each row execute function set_updated_at();
create trigger tenants_updated before update on tenants for each row execute function set_updated_at();
create trigger tenant_members_updated before update on tenant_members for each row execute function set_updated_at();
create trigger mailboxes_updated before update on mailboxes for each row execute function set_updated_at();
create trigger mailbox_members_updated before update on mailbox_members for each row execute function set_updated_at();
create trigger mailbox_credentials_updated before update on mailbox_credentials for each row execute function set_updated_at();
create trigger user_preferences_updated before update on user_preferences for each row execute function set_updated_at();
create trigger table_preferences_updated before update on table_preferences for each row execute function set_updated_at();
