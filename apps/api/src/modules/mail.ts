import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { Storage, touchThreads, asJson } from '@apmail/db';
import { toBullJobId, type MailboxPerm } from '@apmail/shared';
import { requireTenant, notFound, conflict, type RequestContext } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from './resources.js';
const idOf = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
export const threadListSchema = z.object({
  view: z.enum(['folder', 'queue', 'label', 'search']).default('folder'),
  folder_id: z.uuid().optional(),
  queue: z
    .enum(['to_reply', 'in_progress', 'awaiting_reply', 'scheduled', 'done', 'overdue'])
    .optional(),
  label_id: z.uuid().optional(),
  q: z.string().max(200).optional(),
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .transform((s) => s === 'true'),
  assigned: z.enum(['any', 'me', 'unassigned']).default('any'),
  sort: z.enum(['recent', 'oldest', 'waiting_longest']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce
    .number()
    .refine((v) => [10, 20, 30, 50, 100].includes(v))
    .default(50),
});
export async function requireThread(
  ctx: RequestContext | null,
  r: Resources,
  id: string,
  perm: MailboxPerm = 'read',
) {
  const c = requireTenant(ctx);
  const thread = await r.db
    .selectFrom('threads')
    .selectAll()
    .where('id', '=', id)
    .where('tenant_id', '=', c.tenantId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!thread) throw notFound();
  const role = await requireMailboxPerm(c, r.db, thread.mailbox_id, perm);
  return { thread, role, c };
}
export function mailEvents(r: Resources, mailboxId: string, ids: string[], userId?: string) {
  r.io
    .to(userId ? 'user:' + userId : 'mailbox:' + mailboxId)
    .emit('threads:changed', { mailbox_id: mailboxId, thread_ids: ids });
  r.io
    .to(userId ? 'user:' + userId : 'mailbox:' + mailboxId)
    .emit('queue-counts:changed', { mailbox_id: mailboxId });
  if (!userId)
    for (const thread_id of ids)
      r.io.to('thread:' + thread_id).emit('thread:messages-changed', { thread_id });
}
type FolderNode = {
  id: string;
  name: string;
  parent_id: string | null;
  special_use: string | null;
  unread_count: number;
  children: FolderNode[];
};
export async function registerMailRoutes(app: FastifyInstance, r: Resources) {
  app.get('/api/mailboxes/:id/folders', async (req) => {
    const id = idOf(req.params),
      c = requireTenant(req.ctx);
    await requireMailboxPerm(c, r.db, id, 'read');
    const rows = await r.db
      .selectFrom('folders as f')
      .select([
        'f.id',
        'f.name',
        'f.parent_id',
        'f.special_use',
        sql<number>`(select count(distinct t.id)::int from messages m join threads t on t.id=m.thread_id left join thread_user_state us on us.thread_id=t.id and us.user_id=${c.userId} where m.folder_id=f.id and m.deleted_at is null and t.last_inbound_at > coalesce(us.last_read_at,'-infinity'::timestamptz))`.as(
          'unread_count',
        ),
      ])
      .where('f.tenant_id', '=', c.tenantId)
      .where('f.mailbox_id', '=', id)
      .where('f.deleted_at', 'is', null)
      .execute();
    const order = ['inbox', 'sent', 'drafts', 'archive', 'junk', 'trash'];
    const nodes = rows
      .sort(
        (a, b) =>
          (a.special_use ? order.indexOf(a.special_use) : 99) -
            (b.special_use ? order.indexOf(b.special_use) : 99) ||
          a.name.localeCompare(b.name, 'pt-BR'),
      )
      .map((f) => ({ ...f, children: [] as FolderNode[] }));
    const roots: FolderNode[] = [];
    for (const f of nodes) {
      const parent = nodes.find((n) => n.id === f.parent_id);
      if (parent) parent.children.push(f);
      else roots.push(f);
    }
    return roots;
  });
  app.get('/api/mailboxes/:id/queue-counts', async (req) => {
    const id = idOf(req.params),
      c = requireTenant(req.ctx);
    await requireMailboxPerm(c, r.db, id, 'read');
    const row = await sql<{
      unread_inbox: number;
    }>`select count(distinct t.id)::int as unread_inbox from threads t join messages m on m.thread_id=t.id join folders f on f.id=m.folder_id left join thread_user_state us on us.thread_id=t.id and us.user_id=${c.userId} where t.tenant_id=${c.tenantId} and t.mailbox_id=${id} and t.deleted_at is null and m.deleted_at is null and f.special_use='inbox' and t.last_inbound_at>coalesce(us.last_read_at,'-infinity'::timestamptz)`.execute(
      r.db,
    );
    return {
      to_reply: 0,
      in_progress: 0,
      awaiting_reply: 0,
      scheduled: 0,
      done_7d: 0,
      overdue: 0,
      unread_inbox: row.rows[0]?.unread_inbox ?? 0,
    };
  });
  app.get('/api/mailboxes/:id/threads', async (req) => {
    const id = idOf(req.params),
      c = requireTenant(req.ctx);
    await requireMailboxPerm(c, r.db, id, 'read');
    const q = threadListSchema.parse(req.query);
    const folder = q.folder_id
      ? await r.db
          .selectFrom('folders')
          .select('id')
          .where('id', '=', q.folder_id)
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst()
      : await r.db
          .selectFrom('folders')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', id)
          .where('special_use', '=', 'inbox')
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
    if (q.folder_id && !folder) throw notFound();
    if (!folder) return { items: [], total: 0, page: q.page, page_size: q.page_size };
    const base = sql`from threads t join lateral (select max(message_at) as last_at,count(*)::int as folder_count from messages where thread_id=t.id and folder_id=${folder.id} and deleted_at is null having count(*)>0) fm on true left join thread_user_state us on us.thread_id=t.id and us.user_id=${c.userId} left join lateral (select from_name,from_address,subject,snippet from messages where thread_id=t.id and folder_id=${folder.id} and deleted_at is null order by message_at desc limit 1) latest on true where t.tenant_id=${c.tenantId} and t.mailbox_id=${id} and t.deleted_at is null ${q.unread ? sql`and t.last_inbound_at>coalesce(us.last_read_at,'-infinity'::timestamptz)` : sql``}`;
    const result = await sql<
      Record<string, unknown> & { total: number }
    >`select t.id,coalesce(nullif(t.subject,''),latest.subject) as subject,latest.snippet,t.participants,fm.folder_count as message_count,t.has_attachments,fm.last_at as last_message_at,t.last_inbound_at,t.queue_status,false as is_overdue,null as assigned_to,coalesce(t.last_inbound_at>coalesce(us.last_read_at,'-infinity'::timestamptz),false) as is_unread,coalesce(us.is_pinned,false) as is_pinned,'[]'::jsonb as labels,false as has_scheduled,jsonb_build_object('name',latest.from_name,'address',latest.from_address) as latest_from,count(*) over()::int as total ${base} order by coalesce(us.is_pinned,false) desc,fm.last_at desc,t.id limit ${q.page_size} offset ${(q.page - 1) * q.page_size}`.execute(
      r.db,
    );
    const total =
      result.rows[0]?.total ??
      (await sql<{ count: number }>`select count(*)::int as count ${base}`.execute(r.db)).rows[0]
        ?.count ??
      0;
    return {
      items: result.rows.map((row) => {
        const item = { ...row };
        delete (item as Partial<typeof row>).total;
        return item;
      }),
      total,
      page: q.page,
      page_size: q.page_size,
    };
  });
  app.get('/api/threads/:id', async (req) => {
    const { thread, role, c } = await requireThread(req.ctx, r, idOf(req.params));
    const messages = await r.db
      .selectFrom('messages as m')
      .leftJoin('users as u', 'u.id', 'm.sent_by_user_id')
      .select([
        'm.id',
        'm.folder_id',
        'm.thread_id',
        'm.message_id_header',
        'm.in_reply_to',
        'm.references_headers',
        'm.subject',
        'm.from_address',
        'm.from_name',
        'm.to_addresses',
        'm.cc_addresses',
        'm.bcc_addresses',
        'm.reply_to_addresses',
        'm.message_at',
        'm.direction',
        'm.is_automated',
        'm.snippet',
        'm.body_text',
        'm.body_html',
        'm.has_attachments',
        'm.is_flagged',
        'm.pending_action',
        'm.sent_by_user_id',
        'u.full_name as sent_by_name',
      ])
      .where('m.tenant_id', '=', c.tenantId)
      .where('m.thread_id', '=', thread.id)
      .where('m.deleted_at', 'is', null)
      .orderBy('m.message_at', 'asc')
      .execute();
    const attachments = messages.length
      ? await r.db
          .selectFrom('attachments')
          .select([
            'id',
            'message_id',
            'filename',
            'content_type',
            'size_bytes',
            'content_id',
            'is_inline',
          ])
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', thread.mailbox_id)
          .where(
            'message_id',
            'in',
            messages.map((m) => m.id),
          )
          .execute()
      : [];
    const state = await r.db
      .selectFrom('thread_user_state')
      .select(['is_pinned', 'last_read_at'])
      .where('tenant_id', '=', c.tenantId)
      .where('thread_id', '=', thread.id)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    return {
      thread,
      messages: messages.map((m) => ({
        ...m,
        attachments: attachments.filter((a) => a.message_id === m.id),
        sent_by: m.sent_by_user_id ? { id: m.sent_by_user_id, full_name: m.sent_by_name } : null,
      })),
      cid_map: Object.fromEntries(
        attachments.filter((a) => a.content_id).map((a) => [a.content_id, a.id]),
      ),
      labels: [],
      is_pinned: state?.is_pinned ?? false,
      last_read_at: state?.last_read_at ?? null,
      pending_outbox: await r.db
        .selectFrom('outbox as o')
        .innerJoin('users as u', 'u.id', 'o.created_by')
        .select([
          'o.id',
          'o.status',
          'o.scheduled_at',
          'o.created_by',
          'u.full_name as created_by_name',
        ])
        .where('o.tenant_id', '=', c.tenantId)
        .where('o.thread_id', '=', thread.id)
        .where('o.status', 'in', ['queued', 'scheduled', 'sending'])
        .orderBy('o.send_after')
        .execute(),
      my_role: role,
    };
  });
  for (const action of ['read', 'unread', 'pin'] as const)
    app.post('/api/threads/:id/' + action, async (req) => {
      const { thread, c } = await requireThread(req.ctx, r, idOf(req.params));
      const state = await r.db
        .insertInto('thread_user_state')
        .values({
          thread_id: thread.id,
          tenant_id: c.tenantId,
          user_id: c.userId,
          ...(action === 'pin'
            ? { is_pinned: true }
            : { last_read_at: action === 'read' ? new Date() : null }),
        })
        .onConflict((oc) =>
          oc
            .columns(['thread_id', 'user_id'])
            .doUpdateSet(
              action === 'pin'
                ? { is_pinned: sql`not thread_user_state.is_pinned` }
                : { last_read_at: action === 'read' ? new Date() : null },
            ),
        )
        .returning(['is_pinned', 'last_read_at'])
        .executeTakeFirstOrThrow();
      mailEvents(r, thread.mailbox_id, [thread.id], c.userId);
      return state;
    });

  app.post('/api/mailboxes/:id/threads/bulk', async (req) => {
    const id = idOf(req.params),
      c = requireTenant(req.ctx);
    await requireMailboxPerm(c, r.db, id, 'read');
    const b = z
      .object({ thread_ids: z.array(z.uuid()).min(1).max(100), action: z.enum(['read', 'unread']) })
      .parse(req.body);
    const ids = [...new Set(b.thread_ids)];
    const found = await r.db
      .selectFrom('threads')
      .select('id')
      .where('id', 'in', ids)
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
    if (found.length !== ids.length) throw notFound();
    await r.db.transaction().execute(async (trx) => {
      for (const threadId of ids)
        await trx
          .insertInto('thread_user_state')
          .values({
            thread_id: threadId,
            tenant_id: c.tenantId,
            user_id: c.userId,
            last_read_at: b.action === 'read' ? new Date() : null,
          })
          .onConflict((oc) =>
            oc
              .columns(['thread_id', 'user_id'])
              .doUpdateSet({ last_read_at: b.action === 'read' ? new Date() : null }),
          )
          .execute();
    });
    mailEvents(r, id, ids, c.userId);
    return { updated: ids.length };
  });
  app.post('/api/mailboxes/:id/messages/actions', async (req, reply) => {
    const id = idOf(req.params),
      c = requireTenant(req.ctx);
    await requireMailboxPerm(c, r.db, id, 'organize');
    const b = z
      .object({
        type: z.enum(['move', 'delete', 'restore', 'set_flag']),
        message_ids: z.array(z.uuid()).min(1).max(1000).optional(),
        thread_ids: z.array(z.uuid()).min(1).max(100).optional(),
        target_folder_id: z.uuid().optional(),
        flagged: z.boolean().optional(),
      })
      .refine((b) => b.message_ids || b.thread_ids)
      .parse(req.body);
    if (b.type === 'move' && !b.target_folder_id) throw conflict('Escolha a pasta de destino.');
    if (b.type === 'set_flag' && b.flagged === undefined)
      throw conflict('Informe o estado da sinalização.');
    const action = await r.db.transaction().execute(async (trx) => {
      let query = trx
        .selectFrom('messages')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', id)
        .where('deleted_at', 'is', null);
      query = b.message_ids
        ? query.where('id', 'in', b.message_ids)
        : query.where('thread_id', 'in', b.thread_ids!);
      const messages = await query.orderBy('id').forUpdate().execute();
      if (!messages.length || (b.message_ids && messages.length !== b.message_ids.length))
        throw notFound();
      if (b.thread_ids && new Set(messages.map((m) => m.thread_id)).size !== b.thread_ids.length)
        throw notFound();
      if (messages.some((m) => m.pending_action))
        throw conflict('Aguarde a alteração anterior terminar.');
      const folders = await trx
        .selectFrom('folders')
        .select(['id', 'special_use'])
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', id)
        .where('deleted_at', 'is', null)
        .execute();
      const destination =
        b.type === 'move'
          ? folders.find((f) => f.id === b.target_folder_id)
          : folders.find((f) => f.special_use === (b.type === 'restore' ? 'inbox' : 'trash'));
      if (b.type !== 'set_flag' && !destination)
        throw conflict('A pasta de destino ainda não está disponível nesta caixa.');
      const payload = {
        message_ids: messages.map((m) => m.id),
        target_folder_id: destination?.id,
        flagged: b.flagged,
        previous_folder_ids: Object.fromEntries(messages.map((m) => [m.id, m.folder_id])),
        previous_flags: Object.fromEntries(messages.map((m) => [m.id, m.is_flagged])),
        previous_uids: Object.fromEntries(messages.map((m) => [m.id, m.imap_uid])),
      };
      const row = await trx
        .insertInto('mail_actions')
        .values({
          tenant_id: c.tenantId,
          mailbox_id: id,
          requested_by: c.userId,
          type: b.type,
          payload: asJson(payload),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      for (const m of messages) {
        const permanent =
          b.type === 'delete' && folders.find((f) => f.id === m.folder_id)?.special_use === 'trash';
        await trx
          .updateTable('messages')
          .set({
            pending_action: true,
            ...(b.type === 'set_flag'
              ? { is_flagged: b.flagged }
              : { folder_id: destination!.id, imap_uid: null }),
            ...(permanent ? { deleted_at: new Date() } : {}),
          })
          .where('id', '=', m.id)
          .execute();
      }
      const ids = messages.map((m) => m.thread_id);
      await touchThreads(trx, ids, 'mail_action', c.userId);
      return { id: row.id, ids };
    });
    await r.queues['mail-actions'].add(
      'action',
      { action_id: action.id },
      {
        jobId: toBullJobId('action:' + action.id),
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      },
    );
    mailEvents(r, id, action.ids);
    return reply.code(202).send({ action_id: action.id });
  });
  for (const kind of ['download', 'inline'] as const)
    app.get('/api/attachments/:id/' + kind, async (req, reply) => {
      const c = requireTenant(req.ctx),
        id = idOf(req.params);
      const a = await r.db
        .selectFrom('attachments as a')
        .innerJoin('messages as m', 'm.id', 'a.message_id')
        .selectAll('a')
        .where('a.id', '=', id)
        .where('a.tenant_id', '=', c.tenantId)
        .where('m.deleted_at', 'is', null)
        .executeTakeFirst();
      if (!a) throw notFound();
      await requireMailboxPerm(c, r.db, a.mailbox_id, 'read');
      if (
        kind === 'inline' &&
        !/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(a.content_type)
      )
        throw notFound();
      const filename = a.filename.replace(/[\r\n"\\]/g, '_'),
        ascii = filename.replace(/[^\x20-\x7e]/g, '_');
      reply
        .header(
          'Content-Disposition',
          `${kind === 'inline' ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16))}`,
        )
        .header('Cache-Control', 'private, no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .type(a.content_type);
      return reply.send(await new Storage(r.env.STORAGE_DIR).openReadStream(a.storage_path));
    });
}
