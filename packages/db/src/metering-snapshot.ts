import { sql, type Kysely } from 'kysely';
import { STORAGE_FORMULA_VERSION } from '@apmail/shared';
import type { DB } from './types.js';
import { refreshStorageOwnership } from './metering-files.js';

export type StorageRetention = { hourlyDays?: number; dailyMonths?: number };
export async function publishStorageUsage(
  db: Kysely<DB>,
  runId: string,
  retention: StorageRetention = {},
) {
  const hourlyDays = retention.hourlyDays ?? 90,
    dailyMonths = retention.dailyMonths ?? 24;
  if (
    !Number.isInteger(hourlyDays) ||
    hourlyDays < 1 ||
    hourlyDays > 365 ||
    !Number.isInteger(dailyMonths) ||
    dailyMonths < 12 ||
    dailyMonths > 120
  )
    throw Error('Invalid storage history retention');
  await db
    .transaction()
    .setIsolationLevel('repeatable read')
    .execute(async (tx) => {
      await sql`set local timezone='UTC'`.execute(tx);
      // Completion and publication commit together; failed aggregation remains safely retryable.
      await sql`update storage_scan_runs set state=case when error_count>0 then 'partial' else 'completed' end,finished_at=now() where id=${runId}::uuid`.execute(
        tx,
      );
      await refreshStorageOwnership(tx);
      await sql`with logical as (
      select tenant_id,mailbox_id,category,sum(body_bytes)::bigint as body,sum(metadata_bytes)::bigint as metadata,
        coalesce(sum(body_bytes+metadata_bytes) filter(where retained),0)::bigint as retained
      from storage_logical_rows_v3 group by tenant_id,mailbox_id,category
    ), physical as (
      select coalesce(physical_key,id::text) as identity,
        case when count(distinct tenant_id)>1 or (bool_or(scope='platform') and bool_or(tenant_id is not null)) then 'unassigned'
          when bool_or(scope='platform') then 'platform' when count(distinct tenant_id)=0 then 'unassigned'
          when count(distinct mailbox_id)=1 and bool_and(scope='mailbox') then 'mailbox' else 'tenant' end as scope,
        case when count(distinct tenant_id)=1 and not bool_or(scope='platform') then min(tenant_id::text)::uuid else null end as tenant_id,
        case when count(distinct tenant_id)=1 and count(distinct mailbox_id)=1 and bool_and(scope='mailbox') then min(mailbox_id::text)::uuid else null end as mailbox_id,
        case when count(distinct category)=1 then min(category) else 'shared_file' end as category,
        max(present_bytes)::bigint as bytes,case when bool_and(allocated_bytes is not null) then max(allocated_bytes)::bigint else null end as allocated,
        bool_and(exists(select 1 from mailboxes b where b.id=s.mailbox_id and b.deleted_at is not null)
          or exists(select 1 from tenants t where t.id=s.tenant_id and t.deleted_at is not null)
          or (exists(select 1 from storage_asset_refs r where r.asset_id=s.id and r.source_kind='attachments')
            and not exists(select 1 from storage_asset_refs r join attachments a on r.source_id=a.id join messages m on m.id=a.message_id where r.asset_id=s.id and r.source_kind='attachments' and m.deleted_at is null))) as retained
      from storage_assets s where s.present_bytes is not null and s.state in ('present','unreadable') group by coalesce(physical_key,id::text)
    ), scopes as (
      select 'mailbox'::text as scope,b.id as scope_id,b.tenant_id,b.id as mailbox_id from mailboxes b
      union all select 'tenant',t.id,t.id,null::uuid from tenants t
      union all select 'platform','00000000-0000-0000-0000-000000000000'::uuid,null::uuid,null::uuid
      union all select 'unassigned','00000000-0000-0000-0000-000000000001'::uuid,null::uuid,null::uuid
    ), pieces as (
      select c.scope,c.scope_id,c.tenant_id,c.mailbox_id,l.category,l.body,l.metadata,0::bigint as files,0::bigint as bytes,0::bigint as allocated,false as allocation_unknown,l.retained,(l.mailbox_id is null and l.tenant_id is not null) as shared
      from scopes c join logical l on (l.tenant_id=c.tenant_id and (c.scope='tenant' or l.mailbox_id=c.mailbox_id)) or (c.scope='platform' and l.tenant_id is null)
      union all
      select c.scope,c.scope_id,c.tenant_id,c.mailbox_id,p.category,0,0,1,p.bytes,coalesce(p.allocated,0),p.allocated is null,case when p.retained then p.bytes else 0 end,(p.scope='tenant')
      from scopes c join physical p on (c.scope='tenant' and p.tenant_id=c.tenant_id) or (c.scope='mailbox' and p.scope='mailbox' and p.mailbox_id=c.mailbox_id)
        or (c.scope in ('platform','unassigned') and p.scope=c.scope)
    ), categories as (
      select scope,scope_id,category,sum(body+metadata)::bigint as logical_bytes,sum(bytes)::bigint as file_bytes from pieces group by scope,scope_id,category
    ), totals as (
      select c.*,coalesce(sum(p.body),0)::bigint as body,coalesce(sum(p.metadata),0)::bigint as metadata,
        coalesce(sum(p.bytes),0)::bigint as bytes,coalesce(sum(p.files),0)::bigint as files,
        case when coalesce(bool_or(p.allocation_unknown),false) then null else coalesce(sum(p.allocated),0)::bigint end as allocated,
        coalesce(sum(p.retained),0)::bigint as retained,
        coalesce(sum(p.retained) filter(where p.files=0),0)::bigint as retained_logical,
        coalesce(sum(p.retained) filter(where p.files>0),0)::bigint as retained_file,
        coalesce(sum(p.body+p.metadata) filter(where p.shared),0)::bigint as shared_logical,
        coalesce(sum(p.bytes) filter(where p.shared),0)::bigint as shared_file
      from scopes c left join pieces p on p.scope=c.scope and p.scope_id=c.scope_id group by c.scope,c.scope_id,c.tenant_id,c.mailbox_id
    ) insert into storage_usage_snapshots(scope,scope_id,tenant_id,mailbox_id,formula_version,quality,usage,categories,scan_id)
    select c.scope,c.scope_id,c.tenant_id,c.mailbox_id,${STORAGE_FORMULA_VERSION},
      case when not exists(select 1 from storage_scan_runs where mode='full' and state='completed') then 'pending'
        when (select state in ('partial','failed') from storage_scan_runs where mode='full' order by created_at desc limit 1)
          or not exists(select 1 from storage_scan_runs where mode='full' and state='completed' and finished_at>now()-interval '48 hours') then 'partial'
        when exists(select 1 from storage_assets a where (c.scope='tenant' and a.tenant_id=c.tenant_id) or (c.scope='mailbox' and a.mailbox_id=c.mailbox_id) or (c.scope in ('platform','unassigned') and a.scope=c.scope)
          group by a.scope having bool_or(a.state in ('pending','unreadable')))
          or exists(select 1 from storage_discrepancies d where d.resolved_at is null and (c.scope='tenant' and d.tenant_id=c.tenant_id or c.scope='mailbox' and d.mailbox_id=c.mailbox_id or c.scope in ('platform','unassigned') and d.tenant_id is null)) then 'partial' else 'verified' end,
      jsonb_build_object('logical_bytes',(c.body+c.metadata)::text,'body_bytes',c.body::text,'metadata_bytes',c.metadata::text,
        'file_bytes',c.bytes::text,'allocated_bytes',c.allocated::text,'attributed_bytes',(c.body+c.metadata+c.bytes)::text,
        'retained_bytes',c.retained::text,'retained_file_bytes',c.retained_file::text,'retained_logical_bytes',c.retained_logical::text,'shared_file_bytes',c.shared_file::text,'shared_logical_bytes',c.shared_logical::text,'files',c.files,'messages',(select count(*) from messages m where m.tenant_id=c.tenant_id and (c.scope='tenant' or m.mailbox_id=c.mailbox_id)),
        'discrepancies',(select count(*) from storage_discrepancies d where d.resolved_at is null and (c.scope='tenant' and d.tenant_id=c.tenant_id or c.scope='mailbox' and d.mailbox_id=c.mailbox_id or c.scope in ('platform','unassigned') and d.tenant_id is null))),
      coalesce((select jsonb_agg(jsonb_build_object('category',k.category,'logical_bytes',k.logical_bytes::text,'file_bytes',k.file_bytes::text) order by k.category) from categories k where k.scope=c.scope and k.scope_id=c.scope_id),'[]'::jsonb),${runId}::uuid from totals c`.execute(
        tx,
      );
      // Preserve one sample per scope/hour. Daily rollups retain an observed point, never invented history.
      await sql`with ranked as (select id,row_number() over(partition by scope,scope_id,date_trunc(case when measured_at<now()-make_interval(days=>${hourlyDays}) then 'day' else 'hour' end,measured_at) order by id desc) as rank from storage_usage_snapshots)
      delete from storage_usage_snapshots s using ranked r where s.id=r.id and r.rank>1 and s.scan_id<>${runId}::uuid`.execute(
        tx,
      );
      await sql`delete from storage_usage_snapshots where measured_at<now()-make_interval(months=>${dailyMonths}) and scan_id<>${runId}::uuid`.execute(
        tx,
      );
      await sql`update storage_scan_runs set published_at=now() where id=${runId}::uuid`.execute(
        tx,
      );
    });
}
