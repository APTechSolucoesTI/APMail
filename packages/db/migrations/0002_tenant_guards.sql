-- Cada relação de mensagens deve permanecer na mesma empresa e caixa.
alter table folders add unique (id, tenant_id, mailbox_id);
alter table threads add unique (id, tenant_id, mailbox_id);
alter table threads add unique (id, tenant_id);
alter table messages add unique (id, tenant_id, mailbox_id);
alter table folders add foreign key (parent_id, tenant_id, mailbox_id) references folders(id, tenant_id, mailbox_id);
alter table messages add foreign key (folder_id, tenant_id, mailbox_id) references folders(id, tenant_id, mailbox_id);
alter table messages add foreign key (thread_id, tenant_id, mailbox_id) references threads(id, tenant_id, mailbox_id);
alter table attachments add foreign key (message_id, tenant_id, mailbox_id) references messages(id, tenant_id, mailbox_id);
alter table thread_user_state add foreign key (thread_id, tenant_id) references threads(id, tenant_id);
create trigger folders_tenant before insert or update on folders for each row execute function enforce_tenant_from_mailbox();
create trigger threads_tenant before insert or update on threads for each row execute function enforce_tenant_from_mailbox();
create trigger messages_tenant before insert or update on messages for each row execute function enforce_tenant_from_mailbox();
create trigger attachments_tenant before insert or update on attachments for each row execute function enforce_tenant_from_mailbox();
create trigger mail_actions_tenant before insert or update on mail_actions for each row execute function enforce_tenant_from_mailbox();
