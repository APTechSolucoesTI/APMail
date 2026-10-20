-- Queue retries must not duplicate successful audit events.
alter table audit_logs add column event_key text;
create unique index audit_event_once on audit_logs(tenant_id,event_key);
