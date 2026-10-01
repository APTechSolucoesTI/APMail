create index messages_thread_order_live on messages (thread_id, message_at, id) where deleted_at is null;
create index messages_dashboard_volume on messages (tenant_id, mailbox_id, message_at) include (direction, is_automated, sent_by_user_id, folder_id, thread_id) where deleted_at is null;
create index thread_history_dashboard_done on thread_status_history (tenant_id, mailbox_id, created_at) include (changed_by, to_status);
