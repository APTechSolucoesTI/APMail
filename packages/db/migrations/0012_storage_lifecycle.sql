-- Consumed uploads no longer point to a deliberately removed original.
create or replace function storage_track_reference() returns trigger language plpgsql as $$
declare v_path text;v_tenant uuid;v_box uuid;v_id uuid;v_category text;
begin
 if TG_OP in ('UPDATE','DELETE') then delete from storage_asset_refs where source_kind=TG_TABLE_NAME and source_id=old.id;end if;
 if TG_OP='DELETE' then return old;end if;
 if TG_TABLE_NAME='uploads' and (to_jsonb(new)->>'consumed_at') is not null then return new;end if;
 if TG_TABLE_NAME='users' then v_path=new.avatar_path;v_category='avatar';
 else
  v_path=new.storage_path;v_tenant=new.tenant_id;
  v_category=case TG_TABLE_NAME when 'attachments' then 'attachment' when 'uploads' then 'upload' else 'signature_image' end;
  if TG_TABLE_NAME='attachments' then v_box=new.mailbox_id;end if;
 end if;
 if v_path is null then return new;end if;
 insert into storage_assets(storage_key,scope,tenant_id,mailbox_id,category,expected_bytes)
 values(v_path,case when v_box is not null then 'mailbox' when v_tenant is not null then 'tenant' else 'platform' end,
 v_tenant,v_box,v_category,case when TG_TABLE_NAME='users' then null else (to_jsonb(new)->>'size_bytes')::bigint end)
 on conflict(storage_key) do update set updated_at=now(),revision=storage_assets.revision+1 returning id into v_id;
 insert into storage_asset_refs(source_kind,source_id,asset_id,tenant_id,mailbox_id) values(TG_TABLE_NAME,new.id,v_id,v_tenant,v_box);
 return new;
end $$;
drop trigger storage_upload_ref on uploads;
create trigger storage_upload_ref after insert or update of storage_path,consumed_at or delete on uploads for each row execute function storage_track_reference();
delete from storage_asset_refs r using uploads u where r.source_kind='uploads' and r.source_id=u.id and u.consumed_at is not null;
create index storage_live_outbox_uploads on outbox using gin(attachments) where status in ('draft','queued','scheduled','sending','failed');
create index storage_snapshot_publication on storage_usage_snapshots(scan_id,scope,scope_id);
create index storage_logical_history on storage_usage_snapshots(scope,measured_at);

-- Retained payload is a subset of logical usage; never added again to the total.
do $$
declare r record;v_parts text[]:='{}';v_tenant text;v_box text;v_body text;v_deleted text;v_retained text;
begin
 for r in select * from storage_logical_catalog order by relation_name loop
  v_tenant=case when r.owner_column='platform' then 'null::uuid' when r.relation_name='tenants' then 'r.id' else 'r.tenant_id' end;
  v_box=case when r.owner_column='mailbox_id' then 'r.mailbox_id' else 'null::uuid' end;
  v_body=case r.relation_name when 'messages' then 'octet_length(coalesce(r.body_html,'''')||r.body_text)::bigint' when 'outbox' then 'octet_length(r.body_html)::bigint' else '0::bigint' end;
  v_deleted=case when exists(select 1 from information_schema.columns where table_schema='public' and table_name=r.relation_name and column_name='deleted_at') then 'r.deleted_at is not null' else 'false' end;
  v_retained=format('(%s or exists(select 1 from tenants t where t.id=%s and t.deleted_at is not null) or exists(select 1 from mailboxes b where b.id=%s and b.deleted_at is not null))',v_deleted,v_tenant,v_box);
  v_parts=array_append(v_parts,format('select %s as tenant_id,%s as mailbox_id,%L::text as category,%s as body_bytes,octet_length((to_jsonb(r)-%L::text[])::text)::bigint as metadata_bytes,%s as retained from %I r',v_tenant,v_box,r.category,v_body,r.excluded_columns,v_retained,r.relation_name));
 end loop;
 execute 'create view storage_logical_rows_v2 as '||array_to_string(v_parts,' union all ');
end $$;
