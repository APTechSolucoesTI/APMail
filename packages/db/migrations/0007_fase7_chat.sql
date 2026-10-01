create table chat_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  type chat_type not null,
  name text check (length(name) between 1 and 120),
  direct_key text,
  created_by uuid not null references users(id),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, direct_key),
  unique (id, tenant_id),
  foreign key (tenant_id, created_by) references tenant_members(tenant_id, user_id),
  check ((type='direct' and direct_key is not null and name is null) or (type='group' and name is not null and direct_key is null))
);
create trigger chat_conversations_updated before update on chat_conversations for each row execute function set_updated_at();
create table chat_participants (
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  last_read_at timestamptz,
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (conversation_id, user_id),
  foreign key (conversation_id, tenant_id) references chat_conversations(id, tenant_id) on delete cascade,
  foreign key (tenant_id, user_id) references tenant_members(tenant_id, user_id)
);
create index on chat_participants (tenant_id, user_id, conversation_id) where left_at is null;
alter table threads add constraint threads_id_tenant_unique unique (id, tenant_id);
create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  conversation_id uuid not null references chat_conversations(id) on delete cascade,
  sender_id uuid not null references users(id),
  client_id text check(length(client_id) between 1 and 100),
  body text not null default '' check(length(body)<=4000),
  shared_thread_id uuid references threads(id),
  shared_snapshot jsonb,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (sender_id, client_id),
  foreign key (conversation_id, tenant_id) references chat_conversations(id, tenant_id) on delete cascade,
  foreign key (conversation_id, sender_id) references chat_participants(conversation_id, user_id),
  foreign key (shared_thread_id, tenant_id) references threads(id, tenant_id),
  check (deleted_at is not null or length(trim(body))>0 or shared_thread_id is not null)
);
create index on chat_messages (conversation_id, created_at desc, id desc);
create index on chat_messages (conversation_id, created_at desc) where deleted_at is null;
create function chat_touch_conversation() returns trigger language plpgsql as $$
begin
  update chat_conversations set last_message_at=greatest(last_message_at,new.created_at) where id=new.conversation_id;
  return new;
end $$;
create trigger chat_messages_insert after insert on chat_messages for each row execute function chat_touch_conversation();
