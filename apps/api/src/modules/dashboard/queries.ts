import { sql } from 'kysely';
import type {
  DashboardKpis,
  DailyVolume,
  FolderVolume,
  DashboardQueue,
  UserProductivity,
  StaleThread,
} from '@apmail/shared';
import type { Resources } from '../resources.js';
import type { DashboardScope } from './service.js';
const start = (s: DashboardScope) => sql`(${s.from}::date::timestamp at time zone ${s.timezone})`;
const end = (s: DashboardScope) => sql`((${s.to}::date+1)::timestamp at time zone ${s.timezone})`;
const boxes = (s: DashboardScope) => sql.join(s.boxIds);
const received = sql`m.direction='inbound' and not m.is_automated and coalesce(f.special_use::text,'')!='junk'`;
export async function kpis(r: Resources, s: DashboardScope) {
  return (
    await sql<DashboardKpis>`
    with volume as (select count(*) filter(where ${received})::int received,count(*) filter(where m.direction='outbound')::int sent,count(*) filter(where m.direction='outbound' and m.sent_by_user_id is not null)::int sent_via_apmail from messages m left join folders f on f.id=m.folder_id where m.tenant_id=${s.tenantId} and m.mailbox_id in (${boxes(s)}) and m.deleted_at is null and m.message_at>=${start(s)} and m.message_at<${end(s)}),
    queues as (select count(*) filter(where queue_status='to_reply')::int to_reply,count(*) filter(where queue_status='in_progress')::int in_progress,count(*) filter(where queue_status='awaiting_reply')::int awaiting_reply,count(*) filter(where queue_status='scheduled')::int scheduled,count(*) filter(where queue_status in ('to_reply','in_progress') and last_inbound_at<now()-make_interval(hours=>${s.sla}))::int overdue from threads where tenant_id=${s.tenantId} and mailbox_id in (${boxes(s)}) and deleted_at is null and not queue_excluded),
    response as (select avg(extract(epoch from(first_response_at-first_inbound_at))/60)::double precision avg_first_response_minutes,coalesce(count(first_response_at)*100.0/nullif(count(*),0),0)::double precision response_rate from threads where tenant_id=${s.tenantId} and mailbox_id in (${boxes(s)}) and deleted_at is null and first_inbound_at>=${start(s)} and first_inbound_at<${end(s)}),
    active as (select count(*)::int active_users from tenant_members tm where tm.tenant_id=${s.tenantId} and tm.status='active' ${s.filtered ? sql`and (tm.role in ('owner','admin') or exists(select 1 from mailbox_members mm where mm.tenant_id=tm.tenant_id and mm.user_id=tm.user_id and mm.mailbox_id in (${boxes(s)})))` : sql``})
    select * from volume cross join queues cross join response cross join active
  `.execute(r.db)
  ).rows[0]!;
}
export async function dailyVolume(r: Resources, s: DashboardScope) {
  return (
    await sql<DailyVolume>`
    with days as (select generate_series(${s.from}::date,${s.to}::date,interval '1 day')::date as day),volume as (select (m.message_at at time zone ${s.timezone})::date as day,count(*) filter(where ${received})::int received,count(*) filter(where m.direction='outbound')::int sent from messages m left join folders f on f.id=m.folder_id where m.tenant_id=${s.tenantId} and m.mailbox_id in (${boxes(s)}) and m.deleted_at is null and m.message_at>=${start(s)} and m.message_at<${end(s)} group by 1)
    select to_char(d.day,'YYYY-MM-DD') as day,coalesce(v.received,0)::int received,coalesce(v.sent,0)::int sent from days d left join volume v on v.day=d.day order by d.day
  `.execute(r.db)
  ).rows;
}
export async function byFolder(r: Resources, s: DashboardScope) {
  return (
    await sql<FolderVolume>`select f.id folder_id,coalesce(f.name,'Sem pasta') folder_name,b.name mailbox_name,count(*) filter(where ${received})::int received,count(*) filter(where m.direction='outbound')::int sent from messages m left join folders f on f.id=m.folder_id join mailboxes b on b.id=m.mailbox_id where m.tenant_id=${s.tenantId} and m.mailbox_id in (${boxes(s)}) and m.deleted_at is null and m.message_at>=${start(s)} and m.message_at<${end(s)} group by f.id,f.name,b.name having count(*) filter(where ${received} or m.direction='outbound')>0 order by received desc,mailbox_name,folder_name`.execute(
      r.db,
    )
  ).rows;
}
export async function dashboardQueues(r: Resources, s: DashboardScope) {
  return (
    await sql<DashboardQueue>`select statuses.status,count(t.id)::int count from unnest(array['to_reply','in_progress','awaiting_reply','scheduled','done']) with ordinality statuses(status,n) left join threads t on t.queue_status::text=statuses.status and t.tenant_id=${s.tenantId} and t.mailbox_id in (${boxes(s)}) and t.deleted_at is null and not t.queue_excluded group by statuses.status,statuses.n order by statuses.n`.execute(
      r.db,
    )
  ).rows;
}
export async function byUser(r: Resources, s: DashboardScope) {
  return (
    await sql<UserProductivity>`
    with outbound as (select m.*,previous.direction previous_direction,previous.message_at previous_at from messages m left join lateral (select p.direction,p.message_at from messages p where p.thread_id=m.thread_id and p.tenant_id=${s.tenantId} and p.deleted_at is null and (p.message_at,p.id)<(m.message_at,m.id) order by p.message_at desc,p.id desc limit 1) previous on true where m.tenant_id=${s.tenantId} and m.mailbox_id in (${boxes(s)}) and m.direction='outbound' and m.deleted_at is null and m.sent_by_user_id is not null and m.message_at>=${start(s)} and m.message_at<${end(s)}),
    sent as (select sent_by_user_id user_id,count(*)::int sent,count(distinct thread_id)::int threads_replied,avg(extract(epoch from(message_at-previous_at))/60) filter(where previous_direction='inbound')::double precision avg_reply_minutes from outbound group by sent_by_user_id),
    assigned as (select assigned_to user_id,count(*)::int open_assigned from threads where tenant_id=${s.tenantId} and mailbox_id in (${boxes(s)}) and deleted_at is null and not queue_excluded and queue_status in ('to_reply','in_progress') group by assigned_to),
    done as (select changed_by user_id,count(*)::int done_in_period from thread_status_history where tenant_id=${s.tenantId} and mailbox_id in (${boxes(s)}) and to_status='done' and created_at>=${start(s)} and created_at<${end(s)} group by changed_by)
    select u.id user_id,u.full_name,case when u.avatar_path is not null then '/api/avatars/'||u.id||'?v='||extract(epoch from u.updated_at)::bigint else null end avatar_url,coalesce(sent.sent,0)::int sent,coalesce(sent.threads_replied,0)::int threads_replied,sent.avg_reply_minutes,coalesce(assigned.open_assigned,0)::int open_assigned,coalesce(done.done_in_period,0)::int done_in_period
    from tenant_members tm join users u on u.id=tm.user_id left join sent on sent.user_id=u.id left join assigned on assigned.user_id=u.id left join done on done.user_id=u.id where tm.tenant_id=${s.tenantId} and (tm.role in ('owner','admin') or exists(select 1 from mailbox_members mm where mm.tenant_id=tm.tenant_id and mm.user_id=u.id and mm.mailbox_id in (${boxes(s)})) or sent.user_id is not null or assigned.user_id is not null or done.user_id is not null) order by sent desc,u.full_name,u.id
  `.execute(r.db)
  ).rows;
}
export async function staleThreads(r: Resources, s: DashboardScope) {
  return (
    await sql<StaleThread>`select t.id thread_id,t.mailbox_id,b.name mailbox_name,t.subject,t.queue_status,u.full_name assigned_name,to_char(t.last_inbound_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') last_inbound_at,greatest(0,floor(extract(epoch from(now()-t.last_inbound_at))/60))::int waiting_minutes,t.last_inbound_at<now()-make_interval(hours=>${s.sla}) is_overdue from threads t join mailboxes b on b.id=t.mailbox_id left join users u on u.id=t.assigned_to where t.tenant_id=${s.tenantId} and t.mailbox_id in (${boxes(s)}) and t.deleted_at is null and not t.queue_excluded and t.queue_status in ('to_reply','in_progress') and t.last_inbound_at is not null order by t.last_inbound_at,t.id limit ${s.limit}`.execute(
      r.db,
    )
  ).rows;
}
