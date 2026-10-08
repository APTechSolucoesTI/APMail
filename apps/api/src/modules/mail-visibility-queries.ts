import { columnFilters, columnOrder, localizedColumn } from './list-columns.js';
import { QUEUE_LABELS } from '@apmail/shared';
import { sql, type CompiledQuery } from 'kysely';
import type { z } from 'zod';
import type { Resources } from './resources.js';
import { threadListSchema } from './mail.js';
import { notFound, requireTenant } from '../authz/context.js';
import { readableFolders, folderPredicate } from '../authz/folders.js';
export async function listThreads(
  r: Resources,
  c: ReturnType<typeof requireTenant>,
  boxId: string,
  q: z.infer<typeof threadListSchema>,
  inspect?: (query: CompiledQuery) => Promise<void>,
) {
  const scope = await readableFolders(c, r.db, boxId);
  let folderId: string | null = null;
  if (q.view === 'folder') {
    let query = r.db
      .selectFrom('folders')
      .select('id')
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', boxId)
      .where('deleted_at', 'is', null)
      .where(folderPredicate(scope, 'folders.id'));
    query = q.folder_id
      ? query.where('id', '=', q.folder_id)
      : query.where('special_use', '=', 'inbox');
    const folder = await query.executeTakeFirst();
    if (q.folder_id && !folder) throw notFound();
    if (!folder) return { items: [], total: 0, page: q.page, page_size: q.page_size };
    folderId = folder.id;
  }
  if (q.view === 'label') {
    const label = q.label_id
      ? await r.db
          .selectFrom('personal_labels')
          .select('id')
          .where('id', '=', q.label_id)
          .where(
            sql<boolean>`(mailbox_mode='all' or exists(select 1 from label_mailboxes lm where lm.label_id=personal_labels.id and lm.mailbox_id=${boxId} and lm.tenant_id=personal_labels.tenant_id))`,
          )
          .where('tenant_id', '=', c.tenantId)
          .where((eb) => eb.or([eb('scope', '=', 'tenant'), eb('user_id', '=', c.userId)]))
          .executeTakeFirst()
      : null;
    if (!label) throw notFound();
  }
  const conditions = [
    sql`t.tenant_id=${c.tenantId}`,
    sql`t.mailbox_id=${boxId}`,
    sql`t.deleted_at is null`,
  ];
  if (q.assigned === 'me') conditions.push(sql`t.assigned_to=${c.userId}`);
  else if (q.assigned === 'unassigned') conditions.push(sql`t.assigned_to is null`);
  if (q.view === 'queue') {
    conditions.push(sql`not t.queue_excluded`);
    if (q.queue === 'overdue') conditions.push(sql`t.queue_status in ('to_reply','in_progress')`);
    else if (q.queue) conditions.push(sql`t.queue_status=${q.queue}::queue_status`);
    else conditions.push(sql`t.queue_status!='none'`);
  }
  if (q.view === 'label')
    conditions.push(
      sql`exists(select 1 from thread_personal_labels tl where tl.thread_id=t.id and tl.label_id=${q.label_id} and tl.tenant_id=${c.tenantId} and (tl.user_id=${c.userId} or exists(select 1 from personal_labels l where l.id=tl.label_id and l.tenant_id=tl.tenant_id and l.scope='tenant')))`,
    );
  if (q.q?.trim())
    conditions.push(
      sql`exists(select 1 from messages sm where sm.thread_id=t.id and sm.tenant_id=${c.tenantId} and sm.deleted_at is null and ${folderPredicate(scope, 'sm.folder_id')} and sm.search_vector @@ websearch_to_tsquery('pt_unaccent',${q.q}))`,
    );
  const folderFilter = folderId ? sql`and m.folder_id=${folderId}` : sql``,
    order =
      q.sort === 'oldest'
        ? sql`last_message_at asc nulls last,id`
        : q.sort === 'waiting_longest'
          ? sql`last_inbound_at asc nulls last,id`
          : sql`is_pinned desc,last_message_at desc nulls last,id`;
  const columns = {
    subject: sql`latest.subject`,
    latest_from: sql`concat_ws(' ',latest.from_name,latest.from_address)`,
    assigned_to: sql`u.full_name`,
    queue_status: localizedColumn(sql`e.queue_status`, QUEUE_LABELS),
    last_message_at: sql`fm.last_message_at`,
    message_count: sql`fm.message_count`,
    has_attachments: localizedColumn(sql`fm.has_attachments`, { true: 'Sim', false: 'Não' }),
    labels: sql`(select string_agg(l.name,' ') from thread_personal_labels tl join personal_labels l on l.id=tl.label_id where tl.thread_id=e.id and (l.scope='tenant' or l.user_id=${c.userId}) and (l.mailbox_mode='all' or exists(select 1 from label_mailboxes lm where lm.label_id=l.id and lm.mailbox_id=${boxId})))`,
  };
  const overdue = sql`(e.queue_status in ('to_reply','in_progress') and not e.queue_excluded and fm.last_inbound_at<now()-make_interval(hours=>coalesce((tenant.settings->>'sla_first_response_hours')::int,24)))`;
  const inbound = sql`m.direction='inbound' and not m.is_automated and coalesce(f.special_use::text,'') not in ('trash','junk')`;
  const listOrder = columnOrder(
    q,
    {
      subject: sql`subject`,
      latest_from: sql`latest_from_sort`,
      assigned_to: sql`assigned_to_sort`,
      queue_status: sql`queue_status`,
      last_message_at: sql`last_message_at`,
      message_count: sql`message_count`,
      has_attachments: sql`has_attachments`,
    },
    order,
  );
  const query = sql<{ items: Record<string, unknown>[]; total: number }>`
 with eligible as materialized (
  select t.id,t.assigned_to,t.queue_status,t.queue_excluded,us.last_read_at,coalesce(us.is_pinned,false) as is_pinned from threads t
  left join thread_user_state us on us.thread_id=t.id and us.tenant_id=${c.tenantId} and us.user_id=${c.userId} where ${sql.join(conditions, sql` and `)}
 ), fm as (
  select m.thread_id,count(*)::int as message_count,max(m.message_at) as last_message_at,max(m.message_at) filter(where ${inbound}) as last_inbound_at,bool_or(m.has_attachments) as has_attachments
  from messages m join eligible e on e.id=m.thread_id join folders f on f.id=m.folder_id
  where m.tenant_id=${c.tenantId} and m.mailbox_id=${boxId} and m.deleted_at is null and ${folderPredicate(scope)} ${folderFilter} group by m.thread_id
 ), matched as (
  select e.id,latest.subject,concat_ws(' ',latest.from_name,latest.from_address) as latest_from_sort,u.full_name as assigned_to_sort,e.queue_status,e.is_pinned,fm.message_count,fm.has_attachments,fm.last_message_at,fm.last_inbound_at,
   coalesce(fm.last_inbound_at>coalesce(e.last_read_at,'-infinity'::timestamptz),false) as is_unread,coalesce(${overdue},false) as is_overdue,
   case when u.id is null then null else jsonb_build_object('id',u.id,'full_name',u.full_name,'avatar_url',case when u.avatar_path is null then null else '/api/avatars/'||u.id::text||'?v='||extract(epoch from u.updated_at)::bigint end) end as assigned_to
  from eligible e join fm on fm.thread_id=e.id join tenants tenant on tenant.id=${c.tenantId} left join users u on u.id=e.assigned_to join lateral (select m.subject,m.from_name,m.from_address from messages m where m.thread_id=e.id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${folderPredicate(scope)} ${folderFilter} order by m.message_at desc,m.id limit 1) latest on true
  where ${columnFilters(q, columns)} ${q.unread ? sql`and fm.last_inbound_at>coalesce(e.last_read_at,'-infinity'::timestamptz)` : sql``} ${q.queue === 'overdue' && q.view === 'queue' ? sql`and ${overdue}` : sql``}
 ), paged as (select * from matched order by ${listOrder} limit ${q.page_size} offset ${(q.page - 1) * q.page_size}), detailed as (
  select p.*,latest.snippet,jsonb_build_object('name',latest.from_name,'address',latest.from_address) as latest_from,
   coalesce((select array_agg(distinct address) from (
    select lower(m.from_address) as address from messages m where m.thread_id=p.id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${folderPredicate(scope)} ${folderFilter}
    union select lower(a->>'address') from messages m cross join lateral jsonb_array_elements(m.to_addresses||m.cc_addresses) a where m.thread_id=p.id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${folderPredicate(scope)} ${folderFilter}
   ) contacts where address<>lower(box.email_address) and not address=any(box.aliases)), '{}'::text[]) as participants,
   coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'color',l.color,'scope',l.scope) order by (l.scope='tenant') desc,l.name) from thread_personal_labels tl join personal_labels l on l.id=tl.label_id where tl.thread_id=p.id and tl.tenant_id=${c.tenantId} and (l.scope='tenant' or l.user_id=${c.userId}) and (l.mailbox_mode='all' or exists(select 1 from label_mailboxes lm where lm.label_id=l.id and lm.mailbox_id=${boxId} and lm.tenant_id=l.tenant_id))),'[]'::jsonb) as labels,
   exists(select 1 from outbox o where o.thread_id=p.id and o.tenant_id=${c.tenantId} and o.status in ('scheduled','queued','sending')) as has_scheduled
  from paged p join mailboxes box on box.id=${boxId} join lateral (
   select m.subject,m.snippet,m.from_name,m.from_address from messages m where m.thread_id=p.id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${folderPredicate(scope)} ${folderFilter}
   order by ${q.q?.trim() ? sql`(m.search_vector @@ websearch_to_tsquery('pt_unaccent',${q.q})) desc,` : sql``} m.message_at desc,m.id limit 1
  ) latest on true
 ) select coalesce((select jsonb_agg(to_jsonb(detailed) order by ${listOrder}) from detailed),'[]'::jsonb) as items,(select count(*)::int from matched) as total
 `;
  if (inspect) await inspect(query.compile(r.db));
  const result = await query.execute(r.db);
  return { ...result.rows[0]!, page: q.page, page_size: q.page_size };
}
export async function queueCounts(r: Resources, c: ReturnType<typeof requireTenant>, id: string) {
  const scope = await readableFolders(c, r.db, id);
  const result = await sql<Record<string, number>>`
 with visible as (
  select m.thread_id,max(m.message_at) filter(where m.direction='inbound' and not m.is_automated and coalesce(f.special_use::text,'') not in ('trash','junk')) as last_inbound_at,
  max(m.message_at) filter(where m.direction='inbound' and not m.is_automated and f.special_use='inbox') as inbox_at
  from messages m join folders f on f.id=m.folder_id where m.tenant_id=${c.tenantId} and m.mailbox_id=${id} and m.deleted_at is null and ${folderPredicate(scope)} group by m.thread_id
 ) select count(*) filter(where not t.queue_excluded and t.queue_status='to_reply')::int as to_reply,
 count(*) filter(where not t.queue_excluded and t.queue_status='in_progress')::int as in_progress,
 count(*) filter(where not t.queue_excluded and t.queue_status='awaiting_reply')::int as awaiting_reply,
 count(*) filter(where not t.queue_excluded and t.queue_status='scheduled')::int as scheduled,
 count(*) filter(where not t.queue_excluded and t.queue_status='done' and t.queue_status_changed_at>=now()-interval '7 days')::int as done_7d,
 count(*) filter(where not t.queue_excluded and t.queue_status in ('to_reply','in_progress') and v.last_inbound_at<now()-make_interval(hours=>coalesce((tenant.settings->>'sla_first_response_hours')::int,24)))::int as overdue,
 count(*) filter(where v.inbox_at>coalesce(us.last_read_at,'-infinity'::timestamptz))::int as unread_inbox
 from threads t join visible v on v.thread_id=t.id join tenants tenant on tenant.id=t.tenant_id left join thread_user_state us on us.thread_id=t.id and us.tenant_id=${c.tenantId} and us.user_id=${c.userId}
 where t.tenant_id=${c.tenantId} and t.mailbox_id=${id} and t.deleted_at is null`.execute(r.db);
  return result.rows[0]!;
}
