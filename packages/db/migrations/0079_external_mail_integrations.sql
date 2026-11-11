create table integration_api_token_mailboxes (
  tenant_id uuid not null,
  token_id uuid not null,
  mailbox_id uuid not null,
  primary key(tenant_id,token_id,mailbox_id),
  foreign key(tenant_id,token_id) references integration_api_tokens(tenant_id,id) on delete cascade,
  foreign key(mailbox_id,tenant_id) references mailboxes(id,tenant_id) on delete cascade
);
alter table messages add column body_html_original text;

create table integration_event_counters (
  tenant_id uuid primary key references tenants(id),
  last_sequence bigint not null default 0
);
create table integration_message_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null,
  message_id uuid not null unique,
  sequence bigint not null,
  created_at timestamptz not null default now(),
  unique(tenant_id,sequence),
  foreign key(message_id,tenant_id,mailbox_id) references messages(id,tenant_id,mailbox_id) on delete cascade
);
insert into integration_message_events(tenant_id,mailbox_id,message_id,sequence,created_at)
  select tenant_id,mailbox_id,id,row_number() over(partition by tenant_id order by created_at,id),created_at
  from messages where direction='inbound' and deleted_at is null;
insert into integration_event_counters(tenant_id,last_sequence)
  select tenant_id,max(sequence) from integration_message_events group by tenant_id;

create table integration_webhooks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  name text not null check(length(trim(name)) between 1 and 100),
  url text not null check(length(url)<=2048),
  enabled boolean not null default false,
  event text not null default 'email.received' check(event='email.received'),
  encrypted_secret text not null,
  version integer not null default 1,
  created_by uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tenant_id,id)
);
create index integration_webhooks_tenant_idx on integration_webhooks(tenant_id,created_at desc);
create table integration_webhook_mailboxes (
  tenant_id uuid not null,
  webhook_id uuid not null,
  mailbox_id uuid not null,
  primary key(tenant_id,webhook_id,mailbox_id),
  foreign key(tenant_id,webhook_id) references integration_webhooks(tenant_id,id) on delete cascade,
  foreign key(mailbox_id,tenant_id) references mailboxes(id,tenant_id) on delete cascade
);
create index integration_webhook_mailboxes_box_idx on integration_webhook_mailboxes(tenant_id,mailbox_id);
create table integration_webhook_deliveries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  webhook_id uuid not null,
  event_id uuid references integration_message_events(id) on delete set null,
  event_key uuid not null,
  message_identity text,
  webhook_version integer not null,
  is_test boolean not null default false,
  state text not null default 'pending' check(state in ('pending','delivering','retry','delivered','failed','cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  delivered_at timestamptz,
  unique(webhook_id,event_key),
  unique(webhook_id,message_identity),
  foreign key(tenant_id,webhook_id) references integration_webhooks(tenant_id,id) on delete cascade
);
create index integration_webhook_due_idx on integration_webhook_deliveries(next_attempt_at) where state in ('pending','retry','delivering');
create index integration_webhook_history_idx on integration_webhook_deliveries(tenant_id,webhook_id,created_at desc);
create table integration_webhook_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references integration_webhook_deliveries(id) on delete cascade,
  number integer not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  http_status integer,
  error_code text,
  unique(delivery_id,number)
);

create function record_integration_message_event() returns trigger language plpgsql as $$
declare next_sequence bigint; new_event uuid;
begin
  if new.direction<>'inbound' then return new; end if;
  insert into integration_event_counters(tenant_id,last_sequence) values(new.tenant_id,1)
    on conflict(tenant_id) do update set last_sequence=integration_event_counters.last_sequence+1
    returning last_sequence into next_sequence;
  insert into integration_message_events(tenant_id,mailbox_id,message_id,sequence,created_at)
    values(new.tenant_id,new.mailbox_id,new.id,next_sequence,new.created_at) returning id into new_event;
  if not new.is_historical and new.source_kind in ('imap','pop3') and new.deleted_at is null then
    insert into integration_webhook_deliveries(tenant_id,webhook_id,event_id,event_key,webhook_version,message_identity)
      select new.tenant_id,w.id,new_event,new_event,w.version,
        new.mailbox_id::text||':'||encode(sha256(convert_to(new.message_id_header,'UTF8')),'hex')
      from integration_webhooks w join integration_webhook_mailboxes b on b.webhook_id=w.id and b.tenant_id=w.tenant_id
      join tenants t on t.id=w.tenant_id and t.deleted_at is null and t.suspended_at is null
      where w.tenant_id=new.tenant_id and b.mailbox_id=new.mailbox_id and w.enabled
      on conflict do nothing;
  end if;
  return new;
end $$;
create trigger integration_message_received after insert on messages for each row execute function record_integration_message_event();
