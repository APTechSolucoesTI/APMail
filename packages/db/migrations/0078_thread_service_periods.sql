create table thread_service_periods (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  mailbox_id uuid not null,
  thread_id uuid not null,
  assignee_id uuid,
  started_at timestamptz not null,
  ended_at timestamptz,
  foreign key (tenant_id, mailbox_id, thread_id)
    references threads (tenant_id, mailbox_id, id) on delete cascade on update cascade,
  check (ended_at is null or ended_at >= started_at)
);

alter table thread_service_periods enable row level security;

create unique index thread_service_periods_open_uq
  on thread_service_periods (thread_id) where ended_at is null;
create index thread_service_periods_history_idx
  on thread_service_periods (thread_id, started_at, id);
create index thread_service_periods_reporting_idx
  on thread_service_periods (tenant_id, mailbox_id, ended_at) where ended_at is not null;

comment on table thread_service_periods is
  'Intervals while a thread is actionable. A null assignee denotes time waiting for assignment.';
comment on column thread_service_periods.assignee_id is
  'Historical user identifier. Retained after user deletion so the interval is not counted as unassigned.';

insert into thread_service_periods (tenant_id, mailbox_id, thread_id, assignee_id, started_at)
select tenant_id, mailbox_id, id, assigned_to,
  least(now(), coalesce(
    case when assigned_to is null then last_inbound_at
         when assigned_at is not null then greatest(assigned_at, last_inbound_at)
    end, now()))
from threads
where queue_status in ('to_reply', 'in_progress')
  and not queue_excluded and deleted_at is null and manual_done_at is null;

create function track_thread_service_period() returns trigger language plpgsql as $$
declare
  at_time timestamptz := clock_timestamp();
  starts_at timestamptz := at_time;
  actionable boolean := new.queue_status in ('to_reply', 'in_progress')
    and not new.queue_excluded and new.deleted_at is null and new.manual_done_at is null;
  was_actionable boolean := false;
begin
  if tg_op = 'UPDATE' then
    was_actionable := old.queue_status in ('to_reply', 'in_progress')
      and not old.queue_excluded and old.deleted_at is null and old.manual_done_at is null;
    if was_actionable and actionable and old.assigned_to is not distinct from new.assigned_to then
      return new;
    end if;
  end if;

  if was_actionable then
    update thread_service_periods set ended_at = greatest(started_at, at_time)
    where thread_id = new.id and ended_at is null;
  end if;

  if actionable then
    if not was_actionable and new.last_inbound_at is not null then
      if tg_op = 'INSERT' or (
        not old.queue_excluded and old.deleted_at is null and (
          old.queue_status = 'none' or new.last_inbound_at > old.queue_status_changed_at
        )
      ) then
        starts_at := least(at_time, greatest(new.last_inbound_at, new.assigned_at));
      end if;
    end if;
    insert into thread_service_periods (tenant_id, mailbox_id, thread_id, assignee_id, started_at)
    values (new.tenant_id, new.mailbox_id, new.id, new.assigned_to, starts_at);
  end if;
  return new;
end $$;

create trigger track_thread_service_period
  after insert or update of assigned_to, queue_status, queue_excluded, deleted_at, manual_done_at on threads
  for each row execute function track_thread_service_period();
