insert into storage_logical_catalog values('tenants','metadata','id','{}') on conflict do nothing;
create view storage_logical_rows_v3 as select * from storage_logical_rows_v2
union all select id,null::uuid,'metadata',0::bigint,octet_length(to_jsonb(t)::text)::bigint,(deleted_at is not null) from tenants t;
