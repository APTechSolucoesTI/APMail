-- AFTER domain triggers remove derived rows in the same transaction. Check ownership after
-- those triggers/cascades complete, so metering cannot block an otherwise valid domain deletion.
alter table storage_logical_payloads alter constraint storage_logical_payloads_tenant_id_fkey deferrable initially deferred;
alter table storage_logical_payloads alter constraint storage_logical_payloads_mailbox_id_tenant_id_fkey deferrable initially deferred;
