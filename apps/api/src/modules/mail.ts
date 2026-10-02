import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { Storage, touchThreads, asJson } from '@apmail/db';
import { toBullJobId, externalParticipants, type Address, type MailboxPerm } from '@apmail/shared';
import { requireTenant, notFound, conflict, type RequestContext } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import { readableFolders, folderPredicate, requireFolder } from '../authz/folders.js';
import type { Resources } from './resources.js';
import { listThreads, queueCounts } from './mail-visibility-queries.js';
import { replaceLabels, validateLabelIds, labelIdsSchema } from './organization/service.js';
import { bulkQueue } from './thread-operations/service.js';
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
  const folders = await readableFolders(c, r.db, thread.mailbox_id);
  if (folders !== null) {
    const visible = await r.db
      .selectFrom('messages as m')
      .select('m.id')
      .where('m.tenant_id', '=', c.tenantId)
      .where('m.thread_id', '=', thread.id)
      .where('m.deleted_at', 'is', null)
      .where(folderPredicate(folders))
      .executeTakeFirst();
    if (!visible) throw notFound();
  }
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
    const scope = await readableFolders(c, r.db, id);
    const rows = await r.db
      .selectFrom('folders as f')
      .select([
        'f.id',
        'f.name',
        'f.parent_id',
        'f.special_use',
        'f.imap_path',
        'f.special_use_official',
        sql<number>`(select count(distinct t.id)::int from messages m join threads t on t.id=m.thread_id left join thread_user_state us on us.thread_id=t.id and us.user_id=${c.userId} where m.folder_id=f.id and m.deleted_at is null and t.last_inbound_at > coalesce(us.last_read_at,'-infinity'::timestamptz))`.as(
          'unread_count',
        ),
      ])
      .where('f.tenant_id', '=', c.tenantId)
      .where('f.mailbox_id', '=', id)
      .where('f.deleted_at', 'is', null)
      .where(folderPredicate(scope, 'f.id'))
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
    return queueCounts(r, c, id);
  });
  app.get('/api/mailboxes/:id/threads', async (req) => {
    const id = idOf(req.params),
      c = requireTenant(req.ctx);
    await requireMailboxPerm(c, r.db, id, 'read');
    const q = threadListSchema.parse(req.query);
    return listThreads(r, c, id, q);
  });
  app.get('/api/threads/:id', async (req) => {
    const { thread, role, c } = await requireThread(req.ctx, r, idOf(req.params));
    const scope = await readableFolders(c, r.db, thread.mailbox_id);
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
      .where(folderPredicate(scope))
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
    const assignee = thread.assigned_to
      ? await r.db
          .selectFrom('users')
          .select([
            'id',
            'full_name',
            sql<
              string | null
            >`case when avatar_path is not null then '/api/avatars/'||id||'?v='||extract(epoch from updated_at)::bigint else null end`.as(
              'avatar_url',
            ),
          ])
          .where('id', '=', thread.assigned_to)
          .executeTakeFirst()
      : null;
    const tenant = await r.db
      .selectFrom('tenants')
      .select('settings')
      .where('id', '=', c.tenantId)
      .executeTakeFirstOrThrow();
    const sla = Number(
      (tenant.settings as { sla_first_response_hours?: number }).sla_first_response_hours ?? 24,
    );
    const box = await r.db
      .selectFrom('mailboxes')
      .select(['email_address', 'aliases'])
      .where('id', '=', thread.mailbox_id)
      .executeTakeFirstOrThrow();
    const latest = messages.at(-1),
      inbound = messages.filter((m) => m.direction === 'inbound' && !m.is_automated),
      outbound = messages.filter((m) => m.direction === 'outbound');
    const visibleThread =
      scope === null
        ? thread
        : {
            ...thread,
            subject: latest?.subject ?? '',
            subject_normalized: '',
            snippet: latest?.snippet ?? '',
            participants: [
              ...new Set(
                messages.flatMap((m) =>
                  externalParticipants(
                    {
                      ...m,
                      to_addresses: m.to_addresses as Address[],
                      cc_addresses: m.cc_addresses as Address[],
                    },
                    [box.email_address, ...box.aliases],
                  ),
                ),
              ),
            ],
            message_count: messages.length,
            has_attachments: messages.some((m) => m.has_attachments),
            first_message_at: messages[0]?.message_at ?? null,
            last_message_at: latest?.message_at ?? null,
            first_inbound_at: inbound[0]?.message_at ?? null,
            last_inbound_at: inbound.at(-1)?.message_at ?? null,
            last_outbound_at: outbound.at(-1)?.message_at ?? null,
            first_response_at: null,
          };
    return {
      thread: {
        ...visibleThread,
        assigned_to: assignee ?? null,
        is_overdue:
          ['to_reply', 'in_progress'].includes(thread.queue_status) &&
          !!visibleThread.last_inbound_at &&
          visibleThread.last_inbound_at.getTime() < Date.now() - sla * 3600000,
      },
      messages: messages.map((m) => ({
        ...m,
        attachments: attachments.filter((a) => a.message_id === m.id),
        sent_by: m.sent_by_user_id ? { id: m.sent_by_user_id, full_name: m.sent_by_name } : null,
      })),
      cid_map: Object.fromEntries(
        attachments.filter((a) => a.content_id).map((a) => [a.content_id, a.id]),
      ),
      labels: await r.db
        .selectFrom('thread_personal_labels as tl')
        .innerJoin('personal_labels as l', 'l.id', 'tl.label_id')
        .select(['l.id', 'l.name', 'l.color'])
        .where('tl.tenant_id', '=', c.tenantId)
        .where('tl.user_id', '=', c.userId)
        .where('tl.thread_id', '=', thread.id)
        .orderBy('l.name')
        .execute(),
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
      .object({
        thread_ids: z.array(z.uuid()).min(1).max(100),
        action: z.enum(['read', 'unread', 'labels', 'done', 'reopen', 'assign']),
        user_id: z.uuid().nullable().optional(),
        label_ids: labelIdsSchema.shape.label_ids.optional(),
      })
      .parse(req.body);
    const ids = [...new Set(b.thread_ids)];
    for (const threadId of ids) await requireThread(c, r, threadId);
    if (b.action === 'done' || b.action === 'reopen' || b.action === 'assign') {
      if (b.action === 'assign' && b.user_id === undefined)
        throw conflict('Escolha um responsável.');
      return bulkQueue(r, c, id, ids, b.action, b.user_id ?? null);
    }
    const found = await r.db
      .selectFrom('threads')
      .select('id')
      .where('id', 'in', ids)
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', id)
      .where('deleted_at', 'is', null)
      .execute();
    if (found.length !== ids.length) throw notFound();
    const labels =
      b.action === 'labels' ? await validateLabelIds(r, c, labelIdsSchema.parse(b).label_ids) : [];
    await r.db.transaction().execute(async (trx) => {
      if (b.action === 'labels') {
        await replaceLabels(trx, c, ids, labels);
        return;
      }
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
      await touchThreads(trx, ids, 'manual', c.userId);
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
      const message = await r.db
        .selectFrom('messages')
        .select('folder_id')
        .where('id', '=', a.message_id)
        .executeTakeFirstOrThrow();
      await requireFolder(c, r.db, a.mailbox_id, message.folder_id);
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
