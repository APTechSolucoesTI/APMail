import { columnFilters, columnOrder, localizedColumn } from './list-columns.js';
import { QUEUE_LABELS } from '@apmail/shared';
import { sql, type CompiledQuery } from 'kysely';
import type { z } from 'zod';
import type { Resources } from './resources.js';
import { threadListSchema } from './mail.js';
import { notFound, requireTenant } from '../authz/context.js';
import { readableFolders, folderPredicate } from '../authz/folders.js';
import { resolveContacts } from './contact-resolution.js';
export async function listThreads(
  r: Resources,
  c: ReturnType<typeof requireTenant>,
  boxId: string | string[],
  q: z.infer<typeof threadListSchema>,
  inspect?: (query: CompiledQuery) => Promise<void>,
) {
  const boxIds = Array.isArray(boxId) ? boxId : [boxId];
  if (!boxIds.length) return { items: [], total: 0, page: q.page, page_size: q.page_size };
  const scopes = await Promise.all(
    boxIds.map(async (id) => ({ id, folders: await readableFolders(c, r.db, id) })),
  );
  const scope = (column = 'm.folder_id') =>
    sql<boolean>`(${sql.join(
      scopes.map(
        (s) =>
          sql`(${sql.ref(column.split('.')[0] + '.mailbox_id')}=${s.id} and ${folderPredicate(s.folders, column)})`,
      ),
      sql` or `,
    )})`;
  let folderIds: string[] = [];
  let individualMessages = false;
  if (q.view === 'folder') {
    let query = r.db
      .selectFrom('folders')
      .select(['id', 'special_use'])
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', 'in', boxIds)
      .where('deleted_at', 'is', null)
      .where(scope('folders.id'));
    query = q.folder_id
      ? query.where('id', '=', q.folder_id)
      : query.where('special_use', '=', 'inbox');
    const folders = await query.execute();
    const folder = folders[0];
    if (q.folder_id && !folder) throw notFound();
    if (!folder) return { items: [], total: 0, page: q.page, page_size: q.page_size };
    folderIds = folders.map((f) => f.id);
    individualMessages = folder.special_use === 'sent';
  }
  if (q.view === 'label') {
    const label = q.label_id
      ? await r.db
          .selectFrom('personal_labels')
          .select('id')
          .where('id', '=', q.label_id)
          .where(
            sql<boolean>`(mailbox_mode='all' or exists(select 1 from label_mailboxes lm where lm.label_id=personal_labels.id and lm.mailbox_id=${boxIds[0]} and lm.tenant_id=personal_labels.tenant_id))`,
          )
          .where('tenant_id', '=', c.tenantId)
          .where((eb) => eb.or([eb('scope', '=', 'tenant'), eb('user_id', '=', c.userId)]))
          .executeTakeFirst()
      : null;
    if (!label) throw notFound();
  }
  const conditions = [
    sql`t.tenant_id=${c.tenantId}`,
    sql`t.mailbox_id in (${sql.join(boxIds)})`,
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
      sql`exists(select 1 from messages sm where sm.thread_id=t.id and sm.tenant_id=${c.tenantId} and sm.deleted_at is null and ${scope('sm.folder_id')} and sm.search_vector @@ websearch_to_tsquery('pt_unaccent',${q.q}))`,
    );
  const entryId = individualMessages ? sql`m.id` : sql`m.thread_id`;
  const selectedMessage = (alias: string) =>
    individualMessages ? sql`and m.id=${sql.ref(alias + '.entry_id')}` : sql``;
  const folderFilter = folderIds.length ? sql`and m.folder_id in (${sql.join(folderIds)})` : sql``,
    order =
      q.sort === 'oldest'
        ? sql`last_message_at asc nulls last,id,entry_id`
        : q.sort === 'waiting_longest'
          ? sql`last_inbound_at asc nulls last,id,entry_id`
          : sql`is_pinned desc,last_message_at desc nulls last,id,entry_id`;
  const messageSearch =
    individualMessages && q.q?.trim()
      ? sql`and m.search_vector @@ websearch_to_tsquery('pt_unaccent',${q.q})`
      : sql``;
  const columns = {
    subject: sql`latest.subject`,
    latest_from: sql`concat_ws(' ',latest.from_name,latest.from_address)`,
    assigned_to: sql`u.full_name`,
    queue_status: localizedColumn(sql`e.queue_status`, QUEUE_LABELS),
    last_message_at: sql`fm.last_message_at`,
    message_count: sql`fm.message_count`,
    has_attachments: localizedColumn(sql`fm.has_attachments`, { true: 'Sim', false: 'Não' }),
    labels: sql`(select string_agg(l.name,' ') from thread_personal_labels tl join personal_labels l on l.id=tl.label_id where tl.thread_id=e.id and (l.scope='tenant' or l.user_id=${c.userId}) and (l.mailbox_mode='all' or exists(select 1 from label_mailboxes lm where lm.label_id=l.id and lm.mailbox_id in (${sql.join(boxIds)}))))`,
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
  select t.id,t.mailbox_id,t.assigned_to,t.queue_status,t.queue_excluded,t.is_pinned_global,us.last_read_at,(t.is_pinned_global or coalesce(us.is_pinned,false)) as is_pinned from threads t
  left join thread_user_state us on us.thread_id=t.id and us.tenant_id=${c.tenantId} and us.user_id=${c.userId} where ${sql.join(conditions, sql` and `)}
 ), fm as (
  select m.thread_id,${entryId} as entry_id,count(*)::int as message_count,max(m.message_at) as last_message_at,max(m.message_at) filter(where ${inbound}) as last_inbound_at,bool_or(m.has_attachments) as has_attachments
  from messages m join eligible e on e.id=m.thread_id join folders f on f.id=m.folder_id
  where m.tenant_id=${c.tenantId} and m.mailbox_id in (${sql.join(boxIds)}) and m.deleted_at is null and ${scope()} ${folderFilter} ${messageSearch} group by m.thread_id,${entryId}
 ), matched as (
  select e.id,e.mailbox_id,fm.entry_id,${individualMessages ? sql`fm.entry_id` : sql`null::uuid`} as message_id,latest.subject,concat_ws(' ',latest.from_name,latest.from_address) as latest_from_sort,u.full_name as assigned_to_sort,e.queue_status,e.is_pinned,e.is_pinned_global,fm.message_count,fm.has_attachments,fm.last_message_at,fm.last_inbound_at,
   coalesce(fm.last_inbound_at>coalesce(e.last_read_at,'-infinity'::timestamptz),false) as is_unread,coalesce(${overdue},false) as is_overdue,
   case when u.id is null then null else jsonb_build_object('id',u.id,'full_name',u.full_name,'avatar_url',case when u.avatar_path is null then null else '/api/avatars/'||u.id::text||'?v='||extract(epoch from u.updated_at)::bigint end) end as assigned_to
  from eligible e join fm on fm.thread_id=e.id join tenants tenant on tenant.id=${c.tenantId} left join users u on u.id=e.assigned_to join lateral (select m.subject,m.from_name,m.from_address from messages m where m.thread_id=e.id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${scope()} ${folderFilter} ${selectedMessage('fm')} order by m.message_at desc,m.id limit 1) latest on true
  where ${columnFilters(q, columns)} ${q.unread ? sql`and fm.last_inbound_at>coalesce(e.last_read_at,'-infinity'::timestamptz)` : sql``} ${q.queue === 'overdue' && q.view === 'queue' ? sql`and ${overdue}` : sql``}
 ), paged as (select * from matched order by ${listOrder} limit ${q.page_size} offset ${(q.page - 1) * q.page_size}), detailed as (
  select p.*,
   (select count(*)::int from reminders task where task.tenant_id=${c.tenantId} and task.thread_id=p.id and task.status in ('pending','notified')) as pending_task_count,
   (select count(*)::int from reminders task where task.tenant_id=${c.tenantId} and task.thread_id=p.id and task.status='completed') as completed_task_count,
   box.name as mailbox_name,box.email_address as mailbox_email,latest.snippet,jsonb_build_object('name',latest.from_name,'address',latest.from_address) as latest_from,latest.to_addresses as latest_to,latest.direction,
   case when latest.request_read_receipt then case when exists(select 1 from mdn_receipts receipt where receipt.original_message_id=latest.id and receipt.disposition='displayed') then 'confirmed' else 'waiting' end else null end as read_receipt_status,
   coalesce((select array_agg(distinct address) from (
    select lower(m.from_address) as address from messages m where m.thread_id=p.id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${scope()} ${folderFilter} ${selectedMessage('p')}
    union select lower(a->>'address') from messages m cross join lateral jsonb_array_elements(m.to_addresses||m.cc_addresses) a where m.thread_id=p.id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${scope()} ${folderFilter} ${selectedMessage('p')}
   ) contacts where address<>lower(box.email_address) and not address=any(box.aliases)), '{}'::text[]) as participants,
   coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'color',l.color,'scope',l.scope) order by (l.scope='tenant') desc,l.name) from thread_personal_labels tl join personal_labels l on l.id=tl.label_id where tl.thread_id=p.id and tl.tenant_id=${c.tenantId} and (l.scope='tenant' or l.user_id=${c.userId}) and (l.mailbox_mode='all' or exists(select 1 from label_mailboxes lm where lm.label_id=l.id and lm.mailbox_id in (${sql.join(boxIds)}) and lm.tenant_id=l.tenant_id))),'[]'::jsonb) as labels,
   exists(select 1 from outbox o where o.thread_id=p.id and o.tenant_id=${c.tenantId} and o.mdn_original_message_id is null and o.status in ('scheduled','queued','sending')) as has_scheduled
  from paged p join mailboxes box on box.id=p.mailbox_id join lateral (
   select m.id,m.subject,m.snippet,m.from_name,m.from_address,m.to_addresses,m.direction,m.request_read_receipt from messages m where m.thread_id=p.id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${scope()} ${folderFilter} ${selectedMessage('p')}
   order by ${q.q?.trim() ? sql`(m.search_vector @@ websearch_to_tsquery('pt_unaccent',${q.q})) desc,` : sql``} m.message_at desc,m.id limit 1
  ) latest on true
 ) select coalesce((select jsonb_agg(to_jsonb(detailed) order by ${listOrder}) from detailed),'[]'::jsonb) as items,(select count(*)::int from matched) as total
 `;
  if (inspect) await inspect(query.compile(r.db));
  const result = await query.execute(r.db);
  const data = result.rows[0]!;
  const contacts = await resolveContacts(
    r.db,
    c,
    data.items.flatMap((item) => [
      (item.latest_from as { address: string }).address,
      ...(item.latest_to as { address: string }[]).map((a) => a.address),
      ...(item.participants as string[]),
    ]),
  );
  return { ...data, contacts, page: q.page, page_size: q.page_size };
}
export async function queueCounts(
  r: Resources,
  c: ReturnType<typeof requireTenant>,
  id: string | string[],
) {
  const boxIds = Array.isArray(id) ? id : [id];
  if (!boxIds.length)
    return {
      to_reply: 0,
      in_progress: 0,
      awaiting_reply: 0,
      scheduled: 0,
      done_7d: 0,
      overdue: 0,
      unread_inbox: 0,
    };
  const scopes = await Promise.all(
    boxIds.map(async (id) => ({ id, folders: await readableFolders(c, r.db, id) })),
  );
  const scope = () =>
    sql<boolean>`(${sql.join(
      scopes.map((s) => sql`(m.mailbox_id=${s.id} and ${folderPredicate(s.folders)})`),
      sql` or `,
    )})`;
  const result = await sql<Record<string, number>>`
 with visible as (
  select m.thread_id,max(m.message_at) filter(where m.direction='inbound' and not m.is_automated and coalesce(f.special_use::text,'') not in ('trash','junk')) as last_inbound_at,
  max(m.message_at) filter(where m.direction='inbound' and not m.is_automated and f.special_use='inbox') as inbox_at
  from messages m join folders f on f.id=m.folder_id where m.tenant_id=${c.tenantId} and m.mailbox_id in (${sql.join(boxIds)}) and m.deleted_at is null and ${scope()} group by m.thread_id
 ) select count(*) filter(where not t.queue_excluded and t.queue_status='to_reply')::int as to_reply,
 count(*) filter(where not t.queue_excluded and t.queue_status='in_progress')::int as in_progress,
 count(*) filter(where not t.queue_excluded and t.queue_status='awaiting_reply')::int as awaiting_reply,
 count(*) filter(where not t.queue_excluded and t.queue_status='scheduled')::int as scheduled,
 count(*) filter(where not t.queue_excluded and t.queue_status='done' and t.queue_status_changed_at>=now()-interval '7 days')::int as done_7d,
 count(*) filter(where not t.queue_excluded and t.queue_status in ('to_reply','in_progress') and v.last_inbound_at<now()-make_interval(hours=>coalesce((tenant.settings->>'sla_first_response_hours')::int,24)))::int as overdue,
 count(*) filter(where v.inbox_at>coalesce(us.last_read_at,'-infinity'::timestamptz))::int as unread_inbox
 from threads t join visible v on v.thread_id=t.id join tenants tenant on tenant.id=t.tenant_id left join thread_user_state us on us.thread_id=t.id and us.tenant_id=${c.tenantId} and us.user_id=${c.userId}
 where t.tenant_id=${c.tenantId} and t.mailbox_id in (${sql.join(boxIds)}) and t.deleted_at is null`.execute(
    r.db,
  );
  return result.rows[0]!;
}
