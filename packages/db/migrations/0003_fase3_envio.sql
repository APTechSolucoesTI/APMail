create table uploads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id) on delete cascade,
  filename text not null,
  content_type text not null,
  size_bytes int not null,
  storage_path text not null,                       -- "uploads/<tenant>/<user>/<upload_id>"
  consumed_at timestamptz,                          -- preenchido quando o envio foi concluído
  created_at timestamptz not null default now()
);

create table signatures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id) on delete cascade,
  mailbox_id uuid references mailboxes(id) on delete cascade,   -- null = todas as caixas
  name text not null,
  body_html text not null,                          -- sanitizado no cliente (DOMPurify) e na API (sanitize-html)
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create unique index signatures_default_uq on signatures
  (user_id, coalesce(mailbox_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_default and deleted_at is null;

create table outbox (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  thread_id uuid references threads(id),
  reply_to_message_id uuid references messages(id),
  created_by uuid not null references users(id),
  kind outbox_kind not null default 'new',
  status outbox_status not null default 'draft',
  to_addresses jsonb not null default '[]',
  cc_addresses jsonb not null default '[]',
  bcc_addresses jsonb not null default '[]',
  subject text not null default '',
  body_html text not null default '',               -- HTML final (inclui assinatura e citação)
  signature_id uuid references signatures(id),
  attachments jsonb not null default '[]',          -- [{ "source": "upload", "upload_id": uuid } | { "source": "message_attachment", "attachment_id": uuid }]
  scheduled_at timestamptz,
  send_after timestamptz,                           -- momento em que o job deve rodar (agendamento ou fim da janela de desfazer)
  job_id text,                                      -- id do job BullMQ atual ("outbox:<id>:<n>")
  submit_count int not null default 0,
  attempts int not null default 0,
  last_error text,
  message_id_header text,
  sent_message_id uuid references messages(id),
  sent_at timestamptz,
  created_by_rule_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on outbox (status, send_after);
create index on outbox (thread_id) where thread_id is not null;
create index on outbox (created_by, status);
alter table messages add constraint messages_outbox_fk foreign key (outbox_id) references outbox(id);

create trigger signatures_updated_at before update on signatures for each row execute function set_updated_at();
create trigger outbox_updated_at before update on outbox for each row execute function set_updated_at();
