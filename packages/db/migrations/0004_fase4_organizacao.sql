create table personal_labels (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 40),
  color text not null check (color in ('teal','blue','indigo','green','amber','red','slate','cyan')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, tenant_id, name)
);

create table thread_personal_labels (
  thread_id uuid not null references threads(id) on delete cascade,
  label_id uuid not null references personal_labels(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  tenant_id uuid not null references tenants(id),
  created_at timestamptz not null default now(),
  primary key (thread_id, label_id)
);

create table mail_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null references mailboxes(id) on delete cascade,
  scope rule_scope not null,
  owner_user_id uuid references users(id) on delete cascade,
  name text not null,
  is_active boolean not null default true,
  priority int not null default 100,
  match_mode text not null default 'all' check (match_mode in ('all','any')),
  conditions jsonb not null,
  actions jsonb not null,
  stop_processing boolean not null default false,
  created_by uuid references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((scope = 'personal' and owner_user_id is not null) or (scope = 'mailbox' and owner_user_id is null))
);

create trigger personal_labels_updated before update on personal_labels for each row execute function set_updated_at();
create trigger mail_rules_updated before update on mail_rules for each row execute function set_updated_at();
alter table personal_labels add unique (id, tenant_id, user_id);
alter table thread_personal_labels add foreign key (label_id, tenant_id, user_id) references personal_labels(id, tenant_id, user_id) on delete cascade;
alter table thread_personal_labels add foreign key (thread_id, tenant_id) references threads(id, tenant_id) on delete cascade;
alter table mail_rules add foreign key (mailbox_id, tenant_id) references mailboxes(id, tenant_id);
alter table mail_rules add constraint rules_priority_check check (priority between 1 and 999);
alter table mail_rules add constraint rules_name_check check (length(trim(name)) between 2 and 80);
alter table mail_rules add unique (id, tenant_id, mailbox_id);
alter table outbox add foreign key (created_by_rule_id, tenant_id, mailbox_id) references mail_rules(id, tenant_id, mailbox_id);
create index on thread_personal_labels (tenant_id, user_id, label_id);
create index on mail_rules (mailbox_id, scope, priority, created_at) where is_active and deleted_at is null;
