-- Quotas are operational configuration, independent from historical metering snapshots.
alter table uploads add column mailbox_id uuid;
alter table uploads add foreign key(mailbox_id,tenant_id) references mailboxes(id,tenant_id);
update storage_logical_catalog set owner_column='mailbox_id' where relation_name='uploads';
drop trigger storage_payload_track on uploads;
create trigger storage_payload_track after insert or update or delete on uploads for each row execute function storage_track_payload('id','metadata','mailbox_id','storage_path');
create table tenant_storage_limits (
 tenant_id uuid primary key references tenants(id),
 max_mailboxes integer check(max_mailboxes is null or max_mailboxes>=0),
 storage_limit_bytes bigint check(storage_limit_bytes is null or storage_limit_bytes>=0),
 allocation_mode text not null default 'equal' check(allocation_mode in ('equal','manual')),
 revision bigint not null default 1
);
create table mailbox_storage_limits (
 mailbox_id uuid primary key,tenant_id uuid not null,
 allocated_bytes bigint check(allocated_bytes is null or allocated_bytes>=0),
 sync_checkpoint jsonb,paused_at timestamptz,
 provider_status text not null default 'pending' check(provider_status in ('pending','available','unsupported','error')),
 provider_used_bytes bigint,provider_limit_bytes bigint,provider_identity text,provider_checked_at timestamptz,
 foreign key(mailbox_id,tenant_id) references mailboxes(id,tenant_id) on delete cascade
);
create index on mailbox_storage_limits(tenant_id);
insert into tenant_storage_limits(tenant_id) select id from tenants;
insert into mailbox_storage_limits(mailbox_id,tenant_id) select id,tenant_id from mailboxes;

-- Same byte attribution as storage_usage_snapshots; hard links/shared files count once.
create view storage_quota_files as
 select case when count(distinct tenant_id)=1 and not bool_or(scope='platform') then min(tenant_id::text)::uuid else null end as tenant_id,
 case when count(distinct tenant_id)=1 and count(distinct mailbox_id)=1 and bool_and(scope='mailbox') then min(mailbox_id::text)::uuid else null end as mailbox_id,
 max(present_bytes)::bigint as bytes
 from storage_assets where present_bytes is not null and state in ('present','unreadable')
 group by coalesce(physical_key,id::text);
create index storage_quota_logical_scope on storage_logical_payloads(tenant_id,mailbox_id) include(body_bytes,metadata_bytes);
create function storage_quota_usage(p_tenant uuid,p_box uuid default null) returns bigint language sql volatile as $$
 with candidates as (
  select distinct physical_key,case when physical_key is null then id else null end as asset_id
  from storage_assets where tenant_id=p_tenant and present_bytes is not null and state in ('present','unreadable')
 ), physical as (
  select p.* from candidates c cross join lateral (
   select case when count(distinct tenant_id)=1 and not bool_or(scope='platform') then min(tenant_id::text)::uuid else null end as tenant_id,
    case when count(distinct tenant_id)=1 and count(distinct mailbox_id)=1 and bool_and(scope='mailbox') then min(mailbox_id::text)::uuid else null end as mailbox_id,
    max(present_bytes)::bigint as bytes
   from (
    select scope,tenant_id,mailbox_id,present_bytes from storage_assets where physical_key=c.physical_key and present_bytes is not null and state in ('present','unreadable')
    union all
    select scope,tenant_id,mailbox_id,present_bytes from storage_assets where c.physical_key is null and id=c.asset_id and present_bytes is not null and state in ('present','unreadable')
   ) s
  ) p
 ) select (coalesce((select sum(body_bytes+metadata_bytes) from storage_logical_payloads where tenant_id=p_tenant and (p_box is null or mailbox_id=p_box)),0)
 +coalesce((select sum(bytes) from physical where tenant_id=p_tenant and (p_box is null or mailbox_id=p_box)),0))::bigint
$$;
create function storage_quota_assert(p_tenant uuid,p_box uuid,p_growth bigint) returns void language plpgsql as $$
declare v_limit bigint;v_box_limit bigint;
begin
 if p_tenant is null or p_growth<=0 then return;end if;
 -- Serializes content admission, physical writes and quota changes across processes.
 perform 1 from tenants where id=p_tenant for update;
 select storage_limit_bytes into v_limit from tenant_storage_limits where tenant_id=p_tenant;
 if v_limit is not null and storage_quota_usage(p_tenant)+p_growth>v_limit then
  raise exception 'tenant_storage_quota_exceeded';
 end if;
 if p_box is not null then
  select allocated_bytes into v_box_limit from mailbox_storage_limits where tenant_id=p_tenant and mailbox_id=p_box;
  if v_box_limit is not null and storage_quota_usage(p_tenant,p_box)+p_growth>v_box_limit then
   raise exception 'mailbox_storage_quota_exceeded';
  end if;
 end if;
end $$;

-- Validate the complete staged message, including final thread aggregates, before commit/SMTP.
create function storage_quota_assert_current(p_tenant uuid,p_box uuid) returns void language plpgsql as $$
declare v_limit bigint;v_box_limit bigint;
begin
 perform 1 from tenants where id=p_tenant for update;
 select storage_limit_bytes into v_limit from tenant_storage_limits where tenant_id=p_tenant;
 select allocated_bytes into v_box_limit from mailbox_storage_limits where tenant_id=p_tenant and mailbox_id=p_box;
 if v_limit is not null and storage_quota_usage(p_tenant)>v_limit then raise exception 'tenant_storage_quota_exceeded';end if;
 if v_box_limit is not null and storage_quota_usage(p_tenant,p_box)>v_box_limit then raise exception 'mailbox_storage_quota_exceeded';end if;
end $$;

-- Updates keep the previous payload until admission; status updates are not new content.
create or replace function storage_track_payload() returns trigger language plpgsql as $$
declare v_row jsonb;v_key text;v_tenant uuid;v_box uuid;v_body bigint:=0;v_old_bytes bigint:=0;v_metadata bigint;v_check boolean;v_bookkeeping text[];
 v_keys text[]:=string_to_array(TG_ARGV[0],',');v_excluded text[]:=string_to_array(TG_ARGV[3],',');
begin
 if TG_OP='DELETE' then
  v_row=to_jsonb(old);select jsonb_object_agg(k,v_row->k)::text into v_key from unnest(v_keys) k;
  delete from storage_logical_payloads where relation_name=TG_TABLE_NAME and row_key=v_key;
  return old;
 end if;
 v_row=to_jsonb(new);select jsonb_object_agg(k,v_row->k)::text into v_key from unnest(v_keys) k;
 v_tenant=case TG_ARGV[2] when 'platform' then null when 'id' then (v_row->>'id')::uuid else (v_row->>'tenant_id')::uuid end;
 v_box=case when TG_ARGV[2]='mailbox_id' then (v_row->>'mailbox_id')::uuid else null end;
 v_body=case TG_TABLE_NAME when 'messages' then octet_length(coalesce(v_row->>'body_html','')||coalesce(v_row->>'body_text','')) when 'outbox' then octet_length(coalesce(v_row->>'body_html','')) else 0 end;
 v_metadata=octet_length((v_row-v_excluded)::text);
 select coalesce(body_bytes+metadata_bytes,0) into v_old_bytes from storage_logical_payloads where relation_name=TG_TABLE_NAME and row_key=v_key;
 v_check=TG_TABLE_NAME in ('messages','attachments','uploads','outbox') or TG_ARGV[1] in ('contacts','chat','rules','notes','signatures');
 v_bookkeeping=case TG_TABLE_NAME when 'messages' then array['updated_at','deleted_at','imap_uid','folder_id','is_flagged','pending_action','is_seen']
  when 'outbox' then array['updated_at','status','attempts','job_id','message_id_header','sent_at','sent_message_id','thread_id','last_error','send_after','scheduled_at','submit_count']
  when 'uploads' then array['consumed_at'] else array['updated_at','deleted_at','last_read_at','edited_at'] end;
 -- Preserve maintenance and delivery status updates even while full; changed user content
 -- is compared in full, including subjects, addresses and attachment references.
 if TG_OP='UPDATE' and (v_row-v_bookkeeping)=(to_jsonb(old)-v_bookkeeping) then v_check=false;end if;
 if v_check then perform storage_quota_assert(v_tenant,v_box,v_body+v_metadata-coalesce(v_old_bytes,0));end if;
 insert into storage_logical_payloads values(TG_TABLE_NAME,v_key,v_tenant,v_box,TG_ARGV[1],v_body,v_metadata,(v_row->>'deleted_at') is not null)
 on conflict(relation_name,row_key) do update set tenant_id=excluded.tenant_id,mailbox_id=excluded.mailbox_id,category=excluded.category,body_bytes=excluded.body_bytes,metadata_bytes=excluded.metadata_bytes,retained=excluded.retained;
 return new;
end $$;

create function storage_quota_rebalance(p_tenant uuid) returns void language plpgsql as $$
declare v_cap bigint;v_mode text;v_count bigint;
begin
 perform 1 from tenants where id=p_tenant for update;
 select storage_limit_bytes,allocation_mode into v_cap,v_mode from tenant_storage_limits where tenant_id=p_tenant;
 if v_mode='manual' then return;end if;
 select count(*) into v_count from mailboxes where tenant_id=p_tenant and deleted_at is null;
 if v_count=0 then return;end if;
 with boxes as (select id,row_number() over(order by created_at,id) as position from mailboxes where tenant_id=p_tenant and deleted_at is null)
 update mailbox_storage_limits l set allocated_bytes=case when v_cap is null then null else v_cap/v_count+case when b.position<=v_cap%v_count then 1 else 0 end end
 from boxes b where l.mailbox_id=b.id;
end $$;
create function storage_quota_box_guard() returns trigger language plpgsql as $$
declare v_max integer;v_cap bigint;v_mode text;v_remaining bigint;v_tenant uuid;
begin
 v_tenant=coalesce(new.tenant_id,old.tenant_id);
 perform 1 from tenants where id=v_tenant for update;
 insert into tenant_storage_limits(tenant_id) values(v_tenant) on conflict do nothing;
 select max_mailboxes,storage_limit_bytes,allocation_mode into v_max,v_cap,v_mode from tenant_storage_limits where tenant_id=v_tenant;
 if TG_OP='INSERT' or (TG_OP='UPDATE' and old.deleted_at is not null and new.deleted_at is null) then
  if v_max is not null and (select count(*) from mailboxes where tenant_id=v_tenant and deleted_at is null)>=v_max then raise exception 'mailbox_count_limit_exceeded';end if;
  if v_mode='manual' and v_cap is not null then
   select v_cap-coalesce(sum(l.allocated_bytes),0) into v_remaining from mailbox_storage_limits l join mailboxes b on b.id=l.mailbox_id where b.tenant_id=v_tenant and b.deleted_at is null;
   if v_remaining<=0 then raise exception 'mailbox_allocation_required';end if;
  end if;
 end if;
 if TG_OP='DELETE' then return old;end if;
 return new;
end $$;
create trigger quota_box_guard before insert or update of deleted_at or delete on mailboxes for each row execute function storage_quota_box_guard();
create function storage_quota_box_changed() returns trigger language plpgsql as $$
declare v_cap bigint;v_mode text;v_remaining bigint;v_tenant uuid;
begin
 v_tenant=coalesce(new.tenant_id,old.tenant_id);
 if TG_OP<>'DELETE' then
  select storage_limit_bytes,allocation_mode into v_cap,v_mode from tenant_storage_limits where tenant_id=v_tenant;
  select v_cap-coalesce(sum(l.allocated_bytes),0) into v_remaining from mailbox_storage_limits l join mailboxes b on b.id=l.mailbox_id where b.tenant_id=v_tenant and b.deleted_at is null and b.id<>new.id;
  insert into mailbox_storage_limits(mailbox_id,tenant_id,allocated_bytes) values(new.id,v_tenant,case when v_mode='manual' then greatest(v_remaining,0) else null end)
   on conflict(mailbox_id) do update set allocated_bytes=case when v_mode='manual' and old.deleted_at is not null and new.deleted_at is null then greatest(v_remaining,0) else mailbox_storage_limits.allocated_bytes end;
 else
  delete from mailbox_storage_limits where mailbox_id=old.id;
 end if;
 perform storage_quota_rebalance(v_tenant);
 return null;
end $$;
create trigger quota_box_changed after insert or update of deleted_at or delete on mailboxes for each row execute function storage_quota_box_changed();
