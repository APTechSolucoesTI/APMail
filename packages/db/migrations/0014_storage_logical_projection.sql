-- Transactional projection avoids rereading large message bodies at each publication.
create table storage_logical_payloads (
 relation_name text not null,row_key text not null,tenant_id uuid references tenants(id),mailbox_id uuid,
 category text not null,body_bytes bigint not null,metadata_bytes bigint not null,retained boolean not null,
 primary key(relation_name,row_key),foreign key(mailbox_id,tenant_id) references mailboxes(id,tenant_id)
);
create index on storage_logical_payloads(tenant_id,mailbox_id,category);
create function storage_track_payload() returns trigger language plpgsql as $$
declare v_row jsonb;v_key text;v_tenant uuid;v_box uuid;v_body bigint:=0;v_keys text[]:=string_to_array(TG_ARGV[0],',');v_excluded text[]:=string_to_array(TG_ARGV[3],',');
begin
 if TG_OP in ('UPDATE','DELETE') then
  v_row=to_jsonb(old);select jsonb_object_agg(k,v_row->k)::text into v_key from unnest(v_keys) k;
  delete from storage_logical_payloads where relation_name=TG_TABLE_NAME and row_key=v_key;
 end if;
 if TG_OP='DELETE' then return old;end if;
 v_row=to_jsonb(new);select jsonb_object_agg(k,v_row->k)::text into v_key from unnest(v_keys) k;
 v_tenant=case TG_ARGV[2] when 'platform' then null when 'id' then (v_row->>'id')::uuid else (v_row->>'tenant_id')::uuid end;
 v_box=case when TG_ARGV[2]='mailbox_id' then (v_row->>'mailbox_id')::uuid else null end;
 v_body=case TG_TABLE_NAME when 'messages' then octet_length(coalesce(v_row->>'body_html','')||coalesce(v_row->>'body_text','')) when 'outbox' then octet_length(coalesce(v_row->>'body_html','')) else 0 end;
 insert into storage_logical_payloads values(TG_TABLE_NAME,v_key,v_tenant,v_box,TG_ARGV[1],v_body,octet_length((v_row-v_excluded)::text),(v_row->>'deleted_at') is not null)
 on conflict(relation_name,row_key) do update set tenant_id=excluded.tenant_id,mailbox_id=excluded.mailbox_id,category=excluded.category,body_bytes=excluded.body_bytes,metadata_bytes=excluded.metadata_bytes,retained=excluded.retained;
 return new;
end $$;
do $$
declare r record;v_keys text[];v_key text;v_tenant text;v_box text;v_body text;v_retained text;
begin
 for r in select * from storage_logical_catalog order by relation_name loop
  select array_agg(a.attname order by k.ordinality) into v_keys from pg_index i join pg_class c on c.oid=i.indrelid join pg_namespace n on n.oid=c.relnamespace
   cross join lateral unnest(i.indkey) with ordinality k(attnum,ordinality) join pg_attribute a on a.attrelid=c.oid and a.attnum=k.attnum where n.nspname='public' and c.relname=r.relation_name and i.indisprimary;
  if v_keys is null then raise exception 'Payload relation requires primary key: %',r.relation_name;end if;
  v_key=format('(select jsonb_object_agg(k,to_jsonb(r)->k)::text from unnest(%L::text[]) k)',v_keys);
  v_tenant=case r.owner_column when 'platform' then 'null::uuid' when 'id' then 'r.id' else 'r.tenant_id' end;
  v_box=case when r.owner_column='mailbox_id' then 'r.mailbox_id' else 'null::uuid' end;
  v_body=case r.relation_name when 'messages' then 'octet_length(coalesce(r.body_html,'''')||r.body_text)::bigint' when 'outbox' then 'octet_length(r.body_html)::bigint' else '0::bigint' end;
  v_retained='(to_jsonb(r)->>''deleted_at'') is not null';
  execute format('insert into storage_logical_payloads select %L,%s,%s,%s,%L,%s,octet_length((to_jsonb(r)-%L::text[])::text)::bigint,%s from %I r',r.relation_name,v_key,v_tenant,v_box,r.category,v_body,r.excluded_columns,v_retained,r.relation_name);
  execute format('create trigger storage_payload_track after insert or update or delete on %I for each row execute function storage_track_payload(%L,%L,%L,%L)',r.relation_name,array_to_string(v_keys,','),r.category,r.owner_column,array_to_string(r.excluded_columns,','));
 end loop;
end $$;
create or replace view storage_logical_rows_v3 as
 select p.tenant_id,p.mailbox_id,p.category,p.body_bytes,p.metadata_bytes,
 (p.retained or t.deleted_at is not null or b.deleted_at is not null) as retained
 from storage_logical_payloads p left join tenants t on t.id=p.tenant_id left join mailboxes b on b.id=p.mailbox_id;
