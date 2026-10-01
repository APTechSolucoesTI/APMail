alter table mailbox_members add column restrict_to_folders boolean not null default false;
alter table mailbox_members add constraint mailbox_members_folder_scope_unique unique (tenant_id,mailbox_id,user_id);
alter table mailbox_members add constraint mailbox_admin_unrestricted check(role <> 'mailbox_admin' or not restrict_to_folders);
create table folder_permissions (
  tenant_id uuid not null,
  mailbox_id uuid not null,
  user_id uuid not null,
  folder_id uuid not null,
  primary key (tenant_id,mailbox_id,user_id,folder_id),
  foreign key (tenant_id,mailbox_id,user_id) references mailbox_members(tenant_id,mailbox_id,user_id) on delete cascade,
  foreign key (folder_id,tenant_id,mailbox_id) references folders(id,tenant_id,mailbox_id) on delete cascade
);
create index folders_live_parent_scope on folders (tenant_id,mailbox_id,parent_id) where deleted_at is null;
create index messages_live_thread_chronology on messages (tenant_id,mailbox_id,thread_id,message_at desc,id desc) where deleted_at is null;
