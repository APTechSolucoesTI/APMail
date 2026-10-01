-- O cursor IMAP não deve impedir uma nova tentativa após falha nas regras.
alter table messages add column rules_applied_at timestamptz;
alter table messages add column rules_inbox boolean not null default false;
update messages set rules_applied_at=now();
create index messages_pending_rules on messages (mailbox_id, message_at) where direction='inbound' and rules_applied_at is null and deleted_at is null;
-- Reprocessar uma regra não pode encaminhar novamente a mesma mensagem.
create unique index outbox_rule_message_unique on outbox (created_by_rule_id, reply_to_message_id) where created_by_rule_id is not null;
