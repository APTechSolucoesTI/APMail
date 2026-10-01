create table thread_status_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  thread_id uuid not null references threads(id) on delete cascade,
  from_status queue_status,
  to_status queue_status not null,
  changed_by uuid references users(id),
  reason text not null check (reason in ('inbound','outbound','manual','assignment','schedule','rule','sync')),
  created_at timestamptz not null default now(),
  foreign key (thread_id, tenant_id, mailbox_id) references threads(id, tenant_id, mailbox_id) on delete cascade
);
create index on thread_status_history (thread_id, created_at);
create index on thread_status_history (mailbox_id, to_status, created_at);

create table thread_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  thread_id uuid not null references threads(id) on delete cascade,
  author_id uuid not null references users(id),
  body text not null check (length(body) between 1 and 5000),
  mentioned_user_ids uuid[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  foreign key (thread_id, tenant_id, mailbox_id) references threads(id, tenant_id, mailbox_id) on delete cascade
);
create index on thread_notes (thread_id, created_at) where deleted_at is null;
create trigger thread_notes_updated before update on thread_notes for each row execute function set_updated_at();
