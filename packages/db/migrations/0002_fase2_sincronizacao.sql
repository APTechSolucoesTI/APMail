create table folders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  parent_id uuid references folders(id),
  name text not null,
  imap_path text not null,
  delimiter text not null default '/',
  special_use folder_special_use,
  uidvalidity bigint,
  last_uid bigint not null default 0,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index folders_mailbox_path_uq on folders (mailbox_id, imap_path) where deleted_at is null;

create table threads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  subject text not null default '',
  subject_normalized text not null default '',
  participants text[] not null default '{}',        -- endereços externos
  snippet text not null default '',
  message_count int not null default 0,
  has_attachments boolean not null default false,
  first_message_at timestamptz,
  last_message_at timestamptz,
  first_inbound_at timestamptz,
  last_inbound_at timestamptz,                      -- última inbound não automatizada fora de lixeira/spam
  last_outbound_at timestamptz,
  first_response_at timestamptz,                    -- primeira outbound após first_inbound_at
  queue_status queue_status not null default 'none',
  queue_status_changed_at timestamptz not null default now(),
  manual_done_at timestamptz,
  queue_excluded boolean not null default false,
  assigned_to uuid references users(id),
  assigned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index on threads (mailbox_id, last_message_at desc) where deleted_at is null;
create index on threads (mailbox_id, queue_status, last_inbound_at) where deleted_at is null;
create index on threads (mailbox_id, subject_normalized);
create index on threads (assigned_to) where assigned_to is not null;

create table messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  folder_id uuid references folders(id),
  thread_id uuid not null references threads(id),
  imap_uid bigint,                                  -- null enquanto a cópia enviada pelo APMail não foi sincronizada
  message_id_header text not null,
  in_reply_to text,
  references_headers text[] not null default '{}',
  subject text not null default '',
  from_address text not null default '',
  from_name text not null default '',
  to_addresses jsonb not null default '[]',         -- [{ "name": "", "address": "" }]
  cc_addresses jsonb not null default '[]',
  bcc_addresses jsonb not null default '[]',
  reply_to_addresses jsonb not null default '[]',
  message_at timestamptz not null,
  direction message_direction not null,
  is_automated boolean not null default false,
  snippet text not null default '',
  body_text text not null default '',
  body_html text,                                   -- sanitizado pelo worker
  has_attachments boolean not null default false,
  size_bytes int not null default 0,
  is_flagged boolean not null default false,
  sent_by_user_id uuid references users(id),
  outbox_id uuid,                                   -- FK na Fase 3
  pending_action boolean not null default false,
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index messages_folder_uid_uq on messages (folder_id, imap_uid) where imap_uid is not null and deleted_at is null;
create index on messages (mailbox_id, message_id_header);
create index on messages (thread_id, message_at);
create index on messages (folder_id, message_at desc) where deleted_at is null;
create index on messages (mailbox_id, direction, message_at);
create index on messages (sent_by_user_id, message_at) where sent_by_user_id is not null;
create index messages_search_idx on messages using gin (search_vector);

create table attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  message_id uuid not null references messages(id) on delete cascade,
  filename text not null,
  content_type text not null default 'application/octet-stream',
  size_bytes int not null default 0,
  content_id text,
  is_inline boolean not null default false,
  storage_path text not null,                       -- "attachments/<tenant>/<mailbox>/<message>/<attachment_id>"
  created_at timestamptz not null default now()
);
create index on attachments (message_id);

create table thread_user_state (
  thread_id uuid not null references threads(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  last_read_at timestamptz,
  is_pinned boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (thread_id, user_id)
);

create table mail_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  requested_by uuid references users(id),
  type mail_action_type not null,
  payload jsonb not null,
  status job_status not null default 'pending',
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index on mail_actions (status, created_at);

create text search configuration pt_unaccent (copy = pg_catalog.portuguese);
alter text search configuration pt_unaccent
  alter mapping for hword, hword_part, word with unaccent, portuguese_stem;

create or replace function messages_search_vector() returns trigger language plpgsql as $$
begin
  new.search_vector :=
      setweight(to_tsvector('pt_unaccent', coalesce(new.subject,'')), 'A')
   || setweight(to_tsvector('pt_unaccent', coalesce(new.from_name,'') || ' ' || coalesce(new.from_address,'')), 'B')
   || setweight(to_tsvector('pt_unaccent', left(coalesce(new.body_text,''), 100000)), 'C');
  return new;
end $$;
create trigger messages_search_vector_trg before insert or update of subject, from_name, from_address, body_text
  on messages for each row execute function messages_search_vector();

create trigger folders_updated_at before update on folders for each row execute function set_updated_at();
create trigger threads_updated_at before update on threads for each row execute function set_updated_at();
create trigger messages_updated_at before update on messages for each row execute function set_updated_at();
create trigger thread_user_state_updated_at before update on thread_user_state for each row execute function set_updated_at();
