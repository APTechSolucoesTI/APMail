-- Old application versions remain compatible; the new uploader explicitly opts into privacy.
alter table signature_images add column legacy_public boolean not null default true;

create table storage_assets (
 id uuid primary key default gen_random_uuid(),storage_key text not null unique,
 scope text not null default 'unassigned' check(scope in ('mailbox','tenant','platform','unassigned')),
 tenant_id uuid references tenants(id),mailbox_id uuid,
 category text not null default 'unreferenced',expected_bytes bigint,present_bytes bigint,allocated_bytes bigint,
 physical_key text,state text not null default 'pending' check(state in ('pending','present','missing','unreadable','deleted')),
 observed_at timestamptz,updated_at timestamptz not null default now(),revision bigint not null default 1,
 last_scan_id uuid,created_at timestamptz not null default now(),
 foreign key(mailbox_id,tenant_id) references mailboxes(id,tenant_id),
 check ((scope='mailbox' and tenant_id is not null and mailbox_id is not null) or
 (scope='tenant' and tenant_id is not null and mailbox_id is null) or
 (scope in ('platform','unassigned') and tenant_id is null and mailbox_id is null)),
 check(expected_bytes is null or expected_bytes>=0),check(present_bytes is null or present_bytes>=0),
 check(allocated_bytes is null or allocated_bytes>=0)
);
create index on storage_assets(tenant_id,mailbox_id);
create index on storage_assets(updated_at,id);
create index on storage_assets(physical_key) where physical_key is not null;
create table storage_asset_refs (
 source_kind text not null,source_id uuid not null,asset_id uuid not null references storage_assets(id),
 tenant_id uuid references tenants(id),mailbox_id uuid,created_at timestamptz not null default now(),
 primary key(source_kind,source_id),foreign key(mailbox_id,tenant_id) references mailboxes(id,tenant_id)
);
create index on storage_asset_refs(asset_id);
create table storage_operations (
 id uuid primary key default gen_random_uuid(),storage_key text not null,
 operation text not null check(operation in ('write','copy','delete')),
 state text not null default 'pending' check(state in ('pending','done','failed')),
 created_at timestamptz not null default now(),finished_at timestamptz
);
create index on storage_operations(state,created_at);
create table storage_scan_runs (
 id uuid primary key default gen_random_uuid(),mode text not null check(mode in ('full','changed','publish')),
 state text not null default 'queued' check(state in ('queued','running','completed','partial','failed')),
 requested_by uuid references users(id),tenant_id uuid references tenants(id),
 started_at timestamptz,finished_at timestamptz,cursor text,checked_files bigint not null default 0,
 error_count bigint not null default 0,error_code text,
 created_at timestamptz not null default now(),published_at timestamptz
);
create index on storage_scan_runs(created_at desc);
create table storage_discrepancies (
 id uuid primary key default gen_random_uuid(),asset_id uuid references storage_assets(id),
 code text not null,tenant_id uuid references tenants(id),mailbox_id uuid,
 first_seen_at timestamptz not null default now(),last_seen_at timestamptz not null default now(),resolved_at timestamptz,
 unique(asset_id,code),foreign key(mailbox_id,tenant_id) references mailboxes(id,tenant_id)
);
create index on storage_discrepancies(tenant_id,mailbox_id) where resolved_at is null;
create table storage_usage_snapshots (
 id bigserial primary key,scope text not null check(scope in ('mailbox','tenant','platform','unassigned')),
 scope_id uuid not null,tenant_id uuid references tenants(id),mailbox_id uuid,
 formula_version text not null,measured_at timestamptz not null default now(),
 quality text not null check(quality in ('pending','verified','partial')),
 usage jsonb not null,categories jsonb not null,scan_id uuid references storage_scan_runs(id),
 foreign key(mailbox_id,tenant_id) references mailboxes(id,tenant_id)
);
create index on storage_usage_snapshots(scope,scope_id,measured_at desc);
create table platform_metric_samples (
 id bigserial primary key,source text not null,measured_at timestamptz not null default now(),
 metrics jsonb not null
);
create index on platform_metric_samples(source,measured_at desc);

-- Domain references are transactional. File observation is independent and survives rollback.
create function storage_track_reference() returns trigger language plpgsql as $$
declare v_path text;v_tenant uuid;v_box uuid;v_id uuid;v_category text;
begin
 if TG_OP in ('UPDATE','DELETE') then
  delete from storage_asset_refs where source_kind=TG_TABLE_NAME and source_id=old.id;
 end if;
 if TG_OP='DELETE' then return old;end if;
 if TG_TABLE_NAME='users' then
  v_path=new.avatar_path;v_category='avatar';
 else
  v_path=new.storage_path;v_tenant=new.tenant_id;
  v_category=case TG_TABLE_NAME when 'attachments' then 'attachment' when 'uploads' then 'upload' else 'signature_image' end;
  if TG_TABLE_NAME='attachments' then v_box=new.mailbox_id;end if;
 end if;
 if v_path is null then return new;end if;
 insert into storage_assets(storage_key,scope,tenant_id,mailbox_id,category,expected_bytes)
 values(v_path,case when v_box is not null then 'mailbox' when v_tenant is not null then 'tenant' else 'platform' end,
 v_tenant,v_box,v_category,case when TG_TABLE_NAME='users' then null else (to_jsonb(new)->>'size_bytes')::bigint end)
 on conflict(storage_key) do update set updated_at=now(),revision=storage_assets.revision+1
 returning id into v_id;
 insert into storage_asset_refs(source_kind,source_id,asset_id,tenant_id,mailbox_id)
 values(TG_TABLE_NAME,new.id,v_id,v_tenant,v_box);
 return new;
end $$;
create trigger storage_attachment_ref after insert or update of storage_path or delete on attachments for each row execute function storage_track_reference();
create trigger storage_upload_ref after insert or update of storage_path or delete on uploads for each row execute function storage_track_reference();
create trigger storage_signature_ref after insert or update of storage_path or delete on signature_images for each row execute function storage_track_reference();
create trigger storage_avatar_ref after insert or update of avatar_path or delete on users for each row execute function storage_track_reference();

-- Backfill only database references; never move, read contents or delete existing files.
insert into storage_assets(storage_key,scope,tenant_id,mailbox_id,category,expected_bytes)
select storage_path,'mailbox',tenant_id,mailbox_id,'attachment',size_bytes from attachments
union all select storage_path,'tenant',tenant_id,null,'upload',size_bytes from uploads
union all select storage_path,'tenant',tenant_id,null,'signature_image',size_bytes from signature_images
union all select avatar_path,'platform',null,null,'avatar',null from users where avatar_path is not null
on conflict(storage_key) do nothing;
insert into storage_asset_refs(source_kind,source_id,asset_id,tenant_id,mailbox_id)
select 'attachments',a.id,s.id,a.tenant_id,a.mailbox_id from attachments a join storage_assets s on s.storage_key=a.storage_path
union all select 'uploads',u.id,s.id,u.tenant_id,null from uploads u join storage_assets s on s.storage_key=u.storage_path
union all select 'signature_images',i.id,s.id,i.tenant_id,null from signature_images i join storage_assets s on s.storage_key=i.storage_path
union all select 'users',u.id,s.id,null,null from users u join storage_assets s on s.storage_key=u.avatar_path;

-- Canonical JSONB payload, not physical PostgreSQL pages. Catalog fixes coverage at migration.
create table storage_logical_catalog(relation_name text primary key,category text not null,owner_column text not null,excluded_columns text[] not null);
do $$
declare r record;v_parts text[]:='{}';v_box text;v_body text;v_excluded text[];v_category text;
begin
 for r in select c.table_name from information_schema.columns c
 where c.table_schema='public' and c.column_name='tenant_id' and c.table_name not like 'storage_%'
 and c.table_name not in ('platform_metric_samples') order by c.table_name
 loop
  v_box=case when exists(select 1 from information_schema.columns where table_schema='public' and table_name=r.table_name and column_name='mailbox_id') then 'r.mailbox_id' else 'null::uuid' end;
  v_excluded=array['storage_path'];v_body='0::bigint';
  if r.table_name='messages' then v_body='octet_length(coalesce(r.body_html,'''') || r.body_text)::bigint';v_excluded=v_excluded||array['body_html','body_text'];end if;
  if r.table_name='outbox' then v_body='octet_length(r.body_html)::bigint';v_excluded=v_excluded||array['body_html'];end if;
  v_category=case when r.table_name like 'contact_%' or r.table_name='contacts' then 'contacts' when r.table_name like 'chat_%' then 'chat' when r.table_name like '%rule%' then 'rules' when r.table_name like '%note%' then 'notes' when r.table_name like '%audit%' then 'audit' when r.table_name like 'signature%' then 'signatures' when r.table_name in ('messages','outbox') then r.table_name else 'metadata' end;
  insert into storage_logical_catalog values(r.table_name,v_category,case when v_box='null::uuid' then 'tenant_id' else 'mailbox_id' end,v_excluded);
  v_parts=v_parts||format('select r.tenant_id,%s as mailbox_id,%L::text as category,%s as body_bytes,octet_length((to_jsonb(r)-%L::text[])::text)::bigint as metadata_bytes from %I r',v_box,v_category,v_body,v_excluded,r.table_name);
 end loop;
 v_parts=array_append(v_parts,'select id,null::uuid,''metadata'',0::bigint,octet_length(to_jsonb(t)::text)::bigint from tenants t');
 for r in select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE'
 and table_name not like 'storage_%' and table_name not in ('schema_migrations','platform_metric_samples','tenants')
 and not exists(select 1 from information_schema.columns c where c.table_schema='public' and c.table_name=tables.table_name and column_name='tenant_id')
 loop
  v_parts=v_parts||format('select null::uuid,null::uuid,''platform_metadata'',0::bigint,octet_length(to_jsonb(r)::text)::bigint from %I r',r.table_name);
  insert into storage_logical_catalog values(r.table_name,'platform_metadata','platform','{}');
 end loop;
 execute 'create view storage_logical_rows as '||array_to_string(v_parts,' union all ');
end $$;
