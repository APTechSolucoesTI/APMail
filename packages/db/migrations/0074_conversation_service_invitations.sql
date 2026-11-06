create unique index threads_service_reference_uq on threads(tenant_id,mailbox_id,id);
create table thread_service_invitations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  mailbox_id uuid not null,
  thread_id uuid not null,
  inviter_id uuid not null references users(id),
  invitee_id uuid not null references users(id),
  state text not null default 'active' check(state in ('active','completed','revoked')),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid references users(id),
  foreign key(tenant_id,mailbox_id,thread_id) references threads(tenant_id,mailbox_id,id) on delete cascade,
  check(inviter_id<>invitee_id),
  check((state='active' and closed_at is null) or (state<>'active' and closed_at is not null))
);
create unique index thread_service_invitation_active_uq on thread_service_invitations(tenant_id,thread_id,invitee_id) where state='active';
create index thread_service_invitation_pending_idx on thread_service_invitations(tenant_id,invitee_id,created_at desc) where state='active';
alter table uploads add column service_thread_id uuid;
alter table uploads add foreign key(tenant_id,mailbox_id,service_thread_id)
  references threads(tenant_id,mailbox_id,id) on delete set null (service_thread_id);
create function close_completed_thread_invitations() returns trigger language plpgsql as $$
begin
  if new.manual_done_at is not null or new.deleted_at is not null or new.queue_status='done' then
    update thread_service_invitations set state='completed',closed_at=now()
    where tenant_id=new.tenant_id and thread_id=new.id and state='active';
  end if;
  return new;
end $$;
create trigger close_completed_thread_invitations after update of manual_done_at,deleted_at,queue_status on threads
  for each row execute function close_completed_thread_invitations();
