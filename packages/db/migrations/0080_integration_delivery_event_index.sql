-- Message/retention cleanup sets event_id to null; avoid scanning the complete delivery history.
create index integration_webhook_delivery_event_idx
  on integration_webhook_deliveries(event_id) where event_id is not null;
