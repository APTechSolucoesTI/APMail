import { sql } from 'kysely';
import type { z } from 'zod';
import type { Resources } from './resources.js';
import { threadListSchema } from './mail.js';
import { notFound, requireTenant } from '../authz/context.js';
export async function listThreads(
  r: Resources,
  c: ReturnType<typeof requireTenant>,
  boxId: string,
  q: z.infer<typeof threadListSchema>,
) {
  let folderId: string | null = null;
  if (q.view === 'folder') {
    let query = r.db
      .selectFrom('folders')
      .select('id')
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', boxId)
      .where('deleted_at', 'is', null);
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
          .where('tenant_id', '=', c.tenantId)
          .where('user_id', '=', c.userId)
          .executeTakeFirst()
      : null;
    if (!label) throw notFound();
  }
  const folderFilter = folderId ? sql`and m.folder_id=${folderId}` : sql``;
  const overdue = sql`(t.queue_status in ('to_reply','in_progress') and not t.queue_excluded and t.last_inbound_at<now()-make_interval(hours=>coalesce((tenant.settings->>'sla_first_response_hours')::int,24)))`;
  const conditions = [
    sql`t.tenant_id=${c.tenantId}`,
    sql`t.mailbox_id=${boxId}`,
    sql`t.deleted_at is null`,
  ];
  if (q.unread)
    conditions.push(sql`t.last_inbound_at>coalesce(us.last_read_at,'-infinity'::timestamptz)`);
  if (q.assigned === 'me') conditions.push(sql`t.assigned_to=${c.userId}`);
  else if (q.assigned === 'unassigned') conditions.push(sql`t.assigned_to is null`);
  if (q.view === 'queue') {
    conditions.push(sql`not t.queue_excluded`);
    if (q.queue === 'overdue') conditions.push(overdue);
    else if (q.queue) conditions.push(sql`t.queue_status=${q.queue}::queue_status`);
    else conditions.push(sql`t.queue_status!='none'`);
  }
  if (q.view === 'label')
    conditions.push(
      sql`exists(select 1 from thread_personal_labels tl where tl.thread_id=t.id and tl.label_id=${q.label_id} and tl.tenant_id=${c.tenantId} and tl.user_id=${c.userId})`,
    );
  if (q.q?.trim())
    conditions.push(
      sql`exists(select 1 from messages sm where sm.thread_id=t.id and sm.tenant_id=${c.tenantId} and sm.deleted_at is null and sm.search_vector @@ websearch_to_tsquery('pt_unaccent',${q.q}))`,
    );
  const order =
    q.sort === 'oldest'
      ? sql`last_message_at asc nulls last,id`
      : q.sort === 'waiting_longest'
        ? sql`last_inbound_at asc nulls last,id`
        : sql`is_pinned desc,last_message_at desc nulls last,id`;
  const result = await sql<{ items: Record<string, unknown>[]; total: number }>`
    with matched as (
      select t.id,t.subject,latest.snippet,t.participants,fm.message_count,t.has_attachments,fm.last_at as last_message_at,t.last_inbound_at,t.queue_status,${overdue} as is_overdue,
      case when u.id is null then null else jsonb_build_object('id',u.id,'full_name',u.full_name,'avatar_url',case when u.avatar_path is null then null else '/api/avatars/'||u.id::text||'?v='||extract(epoch from u.updated_at)::bigint end) end as assigned_to,
      coalesce(t.last_inbound_at>coalesce(us.last_read_at,'-infinity'::timestamptz),false) as is_unread,coalesce(us.is_pinned,false) as is_pinned,
      coalesce((select jsonb_agg(jsonb_build_object('id',l.id,'name',l.name,'color',l.color) order by l.name) from thread_personal_labels tl join personal_labels l on l.id=tl.label_id where tl.thread_id=t.id and tl.tenant_id=${c.tenantId} and tl.user_id=${c.userId}),'[]'::jsonb) as labels,
      exists(select 1 from outbox o where o.thread_id=t.id and o.tenant_id=${c.tenantId} and o.status in ('scheduled','queued','sending')) as has_scheduled,
      jsonb_build_object('name',latest.from_name,'address',latest.from_address) as latest_from,count(*) over()::int as total
      from threads t join tenants tenant on tenant.id=t.tenant_id
      left join thread_user_state us on us.thread_id=t.id and us.tenant_id=${c.tenantId} and us.user_id=${c.userId}
      left join users u on u.id=t.assigned_to
      join lateral (select max(m.message_at) as last_at,count(*)::int as message_count from messages m where m.thread_id=t.id and m.tenant_id=${c.tenantId} and m.deleted_at is null ${folderFilter} having count(*)>0) fm on true
      join lateral (select m.from_name,m.from_address,m.snippet from messages m where m.thread_id=t.id and m.tenant_id=${c.tenantId} and m.deleted_at is null ${folderFilter} order by ${q.q?.trim() ? sql`(m.search_vector @@ websearch_to_tsquery('pt_unaccent',${q.q})) desc,` : sql``} m.message_at desc,m.id limit 1) latest on true
      where ${sql.join(conditions, sql` and `)}
    ), paged as (select * from matched order by ${order} limit ${q.page_size} offset ${(q.page - 1) * q.page_size})
    select coalesce((select jsonb_agg(to_jsonb(paged)-'total' order by ${order}) from paged),'[]'::jsonb) as items,coalesce((select max(total) from matched),0)::int as total
  `.execute(r.db);
  return { ...result.rows[0]!, page: q.page, page_size: q.page_size };
}
export async function queueCounts(r: Resources, c: ReturnType<typeof requireTenant>, id: string) {
  const result = await sql<
    Record<string, number>
  >`select count(*) filter(where not t.queue_excluded and t.queue_status='to_reply')::int as to_reply,count(*) filter(where not t.queue_excluded and t.queue_status='in_progress')::int as in_progress,count(*) filter(where not t.queue_excluded and t.queue_status='awaiting_reply')::int as awaiting_reply,count(*) filter(where not t.queue_excluded and t.queue_status='scheduled')::int as scheduled,count(*) filter(where not t.queue_excluded and t.queue_status='done' and t.queue_status_changed_at>=now()-interval '7 days')::int as done_7d,count(*) filter(where not t.queue_excluded and t.queue_status in ('to_reply','in_progress') and t.last_inbound_at<now()-make_interval(hours=>coalesce((tenant.settings->>'sla_first_response_hours')::int,24)))::int as overdue,count(*) filter(where t.last_inbound_at>coalesce(us.last_read_at,'-infinity'::timestamptz) and exists(select 1 from messages m join folders f on f.id=m.folder_id where m.thread_id=t.id and m.tenant_id=${c.tenantId} and m.deleted_at is null and f.special_use='inbox'))::int as unread_inbox from threads t join tenants tenant on tenant.id=t.tenant_id left join thread_user_state us on us.thread_id=t.id and us.tenant_id=${c.tenantId} and us.user_id=${c.userId} where t.tenant_id=${c.tenantId} and t.mailbox_id=${id} and t.deleted_at is null`.execute(
    r.db,
  );
  return result.rows[0]!;
}
