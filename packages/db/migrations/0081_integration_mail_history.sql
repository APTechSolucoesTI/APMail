-- Keep the inbound sequence and its issued cursors intact while registering outbound mail.
lock table messages in share row exclusive mode;

alter table integration_webhooks
  drop constraint integration_webhooks_event_check,
  add column events text[] not null default array['email.received']::text[],
  add constraint integration_webhooks_event_check check(event in ('email.received','email.sent')),
  add constraint integration_webhooks_events_check check(
    cardinality(events) between 1 and 2
    and events <@ array['email.received','email.sent']::text[]
    and event = any(events)
  );
alter table integration_webhook_deliveries
  add column event_type text not null default 'email.received'
    check(event_type in ('email.received','email.sent'));

insert into integration_message_events(tenant_id,mailbox_id,message_id,sequence,created_at)
select m.tenant_id,m.mailbox_id,m.id,
  coalesce(c.last_sequence,0)+row_number() over(partition by m.tenant_id order by m.created_at,m.id),
  m.created_at
from messages m left join integration_event_counters c on c.tenant_id=m.tenant_id
where m.direction='outbound' and m.deleted_at is null;

insert into integration_event_counters(tenant_id,last_sequence)
select tenant_id,max(sequence) from integration_message_events group by tenant_id
on conflict(tenant_id) do update set last_sequence=greatest(integration_event_counters.last_sequence,excluded.last_sequence);

create or replace function record_integration_message_event() returns trigger language plpgsql as $$
declare next_sequence bigint; new_event uuid; delivery_event text;
begin
  insert into integration_event_counters(tenant_id,last_sequence) values(new.tenant_id,1)
    on conflict(tenant_id) do update set last_sequence=integration_event_counters.last_sequence+1
    returning last_sequence into next_sequence;
  insert into integration_message_events(tenant_id,mailbox_id,message_id,sequence,created_at)
    values(new.tenant_id,new.mailbox_id,new.id,next_sequence,new.created_at) returning id into new_event;
  if new.deleted_at is null and not new.is_historical then
    if new.direction='inbound' and new.source_kind in ('imap','pop3') then
      delivery_event := 'email.received';
    elsif new.direction='outbound' and new.outbox_id is not null then
      delivery_event := 'email.sent';
    end if;
  end if;
  if delivery_event is not null then
    insert into integration_webhook_deliveries(tenant_id,webhook_id,event_id,event_key,webhook_version,message_identity,event_type)
      select new.tenant_id,w.id,new_event,new_event,w.version,
        case when delivery_event='email.sent' then 'sent:' else '' end
        ||new.mailbox_id::text||':'||encode(sha256(convert_to(new.message_id_header,'UTF8')),'hex'),
        delivery_event
      from integration_webhooks w join integration_webhook_mailboxes b on b.webhook_id=w.id and b.tenant_id=w.tenant_id
      join tenants t on t.id=w.tenant_id and t.deleted_at is null and t.suspended_at is null
      where w.tenant_id=new.tenant_id and b.mailbox_id=new.mailbox_id and w.enabled
        and delivery_event = any(w.events)
      on conflict do nothing;
  end if;
  return new;
end $$;
