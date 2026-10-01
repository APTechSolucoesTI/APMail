-- A assinatura global também é específica da empresa atual.
drop index signatures_default_uq;
create unique index signatures_default_uq on signatures
  (tenant_id, user_id, coalesce(mailbox_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where is_default and deleted_at is null;
alter table signatures add unique (id, tenant_id, user_id);
alter table outbox add unique (id, tenant_id, mailbox_id);
alter table mailboxes add unique (id, tenant_id);
alter table signatures add foreign key (mailbox_id, tenant_id) references mailboxes(id, tenant_id);
alter table outbox add foreign key (thread_id, tenant_id, mailbox_id) references threads(id, tenant_id, mailbox_id);
alter table outbox add foreign key (reply_to_message_id, tenant_id, mailbox_id) references messages(id, tenant_id, mailbox_id);
alter table outbox add foreign key (sent_message_id, tenant_id, mailbox_id) references messages(id, tenant_id, mailbox_id);
alter table outbox add foreign key (signature_id, tenant_id, created_by) references signatures(id, tenant_id, user_id);
alter table messages add foreign key (outbox_id, tenant_id, mailbox_id) references outbox(id, tenant_id, mailbox_id);
create trigger outbox_tenant before insert or update on outbox for each row execute function enforce_tenant_from_mailbox();
