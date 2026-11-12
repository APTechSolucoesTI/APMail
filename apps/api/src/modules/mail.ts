import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  Storage,
  touchThreads,
  lockStorageTenant,
  retentionExpiry,
  asJson,
  audit,
  securityForFiles,
  securitySummary,
  assertFilesClean,
  userCanReadThread,
  hasConversationInvitation,
  invitationAllowsPermission,
  operatorThreadPredicate,
} from '@apmail/db';
import { toBullJobId, externalParticipants, type Address, type MailboxPerm } from '@apmail/shared';
import {
  requireTenant,
  requireTenantAdmin,
  notFound,
  conflict,
  type RequestContext,
} from '../authz/context.js';
import { requireMailboxPerm, requireMailboxExists } from '../authz/guards.js';
import { summaryMailboxIds } from './mail-summary.js';
import {
  readableFolders,
  readableThreadFolders,
  folderPredicate,
  requireFolder,
} from '../authz/folders.js';
import type { Resources } from './resources.js';
import { listThreads, queueCounts, unreadInbound } from './mail-visibility-queries.js';
import { replaceLabels, validateLabelIds, labelIdsSchema } from './organization/service.js';
import { bulkQueue } from './thread-operations/service.js';
import { registerReadReceipts } from './read-receipts.js';
import { resolveContacts } from './contact-resolution.js';
import { registerMailboxDrafts } from './mailbox-drafts.js';
import { rememberSpamSenders } from './spam-rules.js';
import { registerMailNavigation } from './mail-navigation.js';
import { queueMailboxTransfer } from './mail-transfer.js';
const idOf = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
export const threadListSchema = z.object({
  columns: z.string().max(16000).optional(),
  column_sort: z.string().max(80).optional(),
  column_direction: z.enum(['asc', 'desc']).optional(),
  view: z.enum(['folder', 'queue', 'label', 'search']).default('folder'),
  folder_id: z.uuid().optional(),
  queue: z
    .enum(['to_reply', 'in_progress', 'awaiting_reply', 'scheduled', 'done', 'overdue'])
    .optional(),
  label_id: z.uuid().optional(),
  mailbox_id: z.uuid().optional(),
  status: z
    .enum(['none', 'to_reply', 'in_progress', 'awaiting_reply', 'scheduled', 'done'])
    .optional(),
  from: z.iso.date().optional(),
  until: z.iso.date().optional(),
  q: z.string().max(200).optional(),
  unread: z
    .enum(['true', 'false'])
    .default('false')
    .transform((s) => s === 'true'),
  assigned: z.union([z.enum(['any', 'me', 'unassigned']), z.uuid()]).default('any'),
  sort: z.enum(['recent', 'oldest', 'waiting_longest']).default('recent'),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce
    .number()
    .refine((v) => [10, 20, 25, 30, 50, 100, 200].includes(v))
    .default(10),
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
  const invitation = await hasConversationInvitation(r.db, c.tenantId, c.userId, id);
  let role: import('@apmail/shared').MailboxRole;
  let delegated = false;
  try {
    role = await requireMailboxPerm(c, r.db, thread.mailbox_id, perm);
    if (!(await userCanReadThread(r.db, c.tenantId, thread.mailbox_id, c.userId, id)))
      throw notFound();
    const normal = (
      await sql<{
        allowed: boolean;
      }>`select ${operatorThreadPredicate(c.tenantId, c.userId, sql`${id}::uuid`, sql`${thread.mailbox_id}::uuid`, false)} as allowed`.execute(
        r.db,
      )
    ).rows[0]?.allowed;
    if (!normal) throw notFound();
    if (
      invitation &&
      role === 'viewer' &&
      perm === 'read' &&
      (await invitationAllowsPermission(r.db, c.tenantId, c.userId, id, 'send'))
    ) {
      role = 'editor';
      delegated = true;
    }
  } catch (error) {
    if (!invitation || !(await invitationAllowsPermission(r.db, c.tenantId, c.userId, id, perm)))
      throw error;
    role = 'editor';
    delegated = true;
  }
  const folders = ['read', 'send', 'note', 'queue'].includes(perm)
    ? await readableThreadFolders(c, r.db, thread.mailbox_id, id)
    : await readableFolders(c, r.db, thread.mailbox_id);
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
  return { thread, role, c, delegated };
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
  await registerMailNavigation(app, r);
  app.get('/api/mail-summary/threads', async (req) => {
    const c = requireTenant(req.ctx),
      q = threadListSchema.parse(req.query);
    if (q.folder_id || q.label_id || q.view === 'label') throw notFound();
    const allowed = await summaryMailboxIds(r, c);
    if (q.mailbox_id && !allowed.includes(q.mailbox_id)) throw notFound();
    return listThreads(r, c, q.mailbox_id ? [q.mailbox_id] : allowed, q);
  });
  app.get('/api/mail-summary/queue-counts', async (req) => {
    const c = requireTenant(req.ctx);
    return queueCounts(r, c, await summaryMailboxIds(r, c));
  });
  await registerMailboxDrafts(app, r);
  await registerReadReceipts(app, r);
  app.get('/api/mailboxes/:id/folders', async (req) => {
    const id = idOf(req.params),
      c = requireTenant(req.ctx);
    const configuration =
      z.object({ configuration: z.enum(['true', 'false']).optional() }).parse(req.query)
        .configuration === 'true';
    if (configuration) {
      requireTenantAdmin(c, 'users.manage');
      await requireMailboxExists(c, r.db, id);
    }
    const scope =
      configuration && !(c.accessRestricted ?? !!c.accessProfileId)
        ? null
        : await readableFolders(c, r.db, id);
    const rows = await r.db
      .selectFrom('folders as f')
      .select([
        'f.id',
        'f.name',
        'f.parent_id',
        'f.special_use',
        'f.imap_path',
        'f.special_use_official',
        'f.sort_order',
        'f.is_local',
        'f.delimiter',
        (configuration
          ? sql<number>`0`
          : sql<number>`(select count(distinct t.id)::int from messages m join threads t on t.id=m.thread_id left join thread_user_state us on us.thread_id=t.id and us.user_id=${c.userId} where m.folder_id=f.id and m.deleted_at is null and ${operatorThreadPredicate(c.tenantId, c.userId, sql`m.thread_id`, sql`m.mailbox_id`)} and (t.last_inbound_at > coalesce(us.last_read_at,'-infinity'::timestamptz) or (m.is_mdn and ${unreadInbound} and m.message_at>coalesce(us.last_read_at,'-infinity'::timestamptz))))`
        ).as('unread_count'),
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
          a.sort_order - b.sort_order ||
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
  app.get('/api/messages/:id/location', async (req, reply) => {
    const c = requireTenant(req.ctx);
    const { id } = z.object({ id: z.guid() }).parse(req.params);
    reply.header('Cache-Control', 'no-store');
    const message = await r.db
      .selectFrom('messages as m')
      .leftJoin('folders as f', (j) =>
        j
          .onRef('f.id', '=', 'm.folder_id')
          .onRef('f.mailbox_id', '=', 'm.mailbox_id')
          .onRef('f.tenant_id', '=', 'm.tenant_id'),
      )
      .innerJoin('mailboxes as b', (j) =>
        j.onRef('b.id', '=', 'm.mailbox_id').onRef('b.tenant_id', '=', 'm.tenant_id'),
      )
      .select(['m.id', 'm.thread_id', 'm.mailbox_id', 'f.id as folder_id'])
      .where('m.id', '=', id)
      .where('m.tenant_id', '=', c.tenantId)
      .where('m.deleted_at', 'is', null)
      .where((eb) => eb.or([eb('m.folder_id', 'is', null), eb('f.id', 'is not', null)]))
      .where('f.deleted_at', 'is', null)
      .where('b.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!message) throw notFound();
    const { delegated } = await requireThread(c, r, message.thread_id);
    const folders = delegated ? [] : await readableFolders(c, r.db, message.mailbox_id);
    if (folders !== null && (!message.folder_id || !folders.includes(message.folder_id))) {
      if (!(await hasConversationInvitation(r.db, c.tenantId, c.userId, message.thread_id)))
        throw notFound();
      return { path: '/invitations?thread=' + message.thread_id };
    }
    const search = new URLSearchParams({
      ...(message.folder_id ? { folderId: message.folder_id } : {}),
      thread: message.thread_id,
      message: message.id,
      assigned: 'any',
    });
    return { path: '/mail/' + message.mailbox_id + '?' + search };
  });
  app.get('/api/threads/:id', async (req) => {
    const { thread, role, c, delegated } = await requireThread(req.ctx, r, idOf(req.params));
    const { message_id: messageId, folder_id: folderId } = z
      .object({ message_id: z.uuid().optional(), folder_id: z.uuid().optional() })
      .parse(req.query);
    const scope = await readableThreadFolders(c, r.db, thread.mailbox_id, thread.id);
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
        'm.request_read_receipt',
        'm.mdn_request',
        'm.calendar_invite',
        'm.is_mdn',
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
      .$if(!!messageId, (query) => query.where('m.id', '=', messageId!))
      .$if(!!folderId, (query) => query.where('m.folder_id', '=', folderId!))
      .where(folderPredicate(scope))
      .orderBy('m.message_at', folderId ? 'desc' : 'asc')
      .orderBy('m.id')
      .$if(!!folderId && !messageId, (query) => query.limit(1))
      .execute();
    if ((messageId || folderId) && !messages.length) throw notFound();
    const attachmentRows = messages.length
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
            'storage_path',
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
    const fileSecurity = await securityForFiles(
      r.db,
      attachmentRows.map((attachment) => attachment.storage_path),
    );
    const attachments = attachmentRows.map(({ storage_path, ...attachment }) => ({
      ...attachment,
      security: securitySummary(fileSecurity.get(storage_path) ?? null),
    }));
    const state = await r.db
      .selectFrom('thread_user_state')
      .select(['is_pinned', 'last_read_at'])
      .where('tenant_id', '=', c.tenantId)
      .where('thread_id', '=', thread.id)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    const decisions = messages.length
      ? await r.db
          .selectFrom('mdn_decisions as d')
          .leftJoin('outbox as o', 'o.id', 'd.outbox_id')
          .select(['d.message_id_header', 'd.decision', 'o.status', 'o.last_error'])
          .where('d.tenant_id', '=', c.tenantId)
          .where('d.mailbox_id', '=', thread.mailbox_id)
          .where(
            'd.message_id_header',
            'in',
            messages.map((m) => m.message_id_header),
          )
          .execute()
      : [];
    const receipts = messages.length
      ? await r.db
          .selectFrom('mdn_receipts')
          .select([
            'original_message_id',
            'recipient_address',
            'disposition',
            'received_at',
            'reported_at',
          ])
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', thread.mailbox_id)
          .where(
            'original_message_id',
            'in',
            messages.map((m) => m.id),
          )
          .orderBy('received_at', 'asc')
          .execute()
      : [];
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
      .select([
        'id',
        'name',
        'email_address',
        'aliases',
        'from_name_template',
        'append_sent_copy',
        'receiving_protocol',
        'status',
        'box_type',
        'owner_user_id',
        'queues_enabled',
      ])
      .where('id', '=', thread.mailbox_id)
      .executeTakeFirstOrThrow();
    const taskCounts = await r.db
      .selectFrom('reminders')
      .select([
        sql<number>`count(*) filter(where status in ('pending','notified'))::int`.as(
          'pending_task_count',
        ),
        sql<number>`count(*) filter(where status='completed')::int`.as('completed_task_count'),
      ])
      .where('tenant_id', '=', c.tenantId)
      .where('thread_id', '=', thread.id)
      .executeTakeFirstOrThrow();
    const servicePeriod =
      box.queues_enabled && thread.assigned_to
        ? await r.db
            .selectFrom('thread_service_periods')
            .select('started_at')
            .where('tenant_id', '=', c.tenantId)
            .where('thread_id', '=', thread.id)
            .where('assignee_id', '=', thread.assigned_to)
            .where('ended_at', 'is', null)
            .executeTakeFirst()
        : undefined;
    const latest = messages.at(-1),
      inbound = messages.filter((m) => m.direction === 'inbound' && !m.is_automated),
      outbound = messages.filter((m) => m.direction === 'outbound' && !m.is_mdn);
    const subject =
      (messages.filter((message) => message.direction === 'inbound').at(-1) ?? latest)?.subject ??
      '';
    const visibleThread =
      scope === null && !messageId && !folderId
        ? { ...thread, subject }
        : {
            ...thread,
            subject,
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
      contacts: await resolveContacts(
        r.db,
        c,
        messages.flatMap((m) => [
          m.from_address,
          ...(m.to_addresses as Address[]).map((a) => a.address),
          ...(m.cc_addresses as Address[]).map((a) => a.address),
          ...(m.reply_to_addresses as Address[]).map((a) => a.address),
        ]),
      ),
      thread: {
        ...visibleThread,
        ...taskCounts,
        assigned_to: assignee ?? null,
        is_assignee_overdue:
          !!servicePeriod &&
          !!visibleThread.last_inbound_at &&
          servicePeriod.started_at.getTime() < Date.now() - sla * 3600000,
        is_overdue:
          !thread.queue_excluded &&
          ['to_reply', 'in_progress'].includes(thread.queue_status) &&
          !!visibleThread.last_inbound_at &&
          visibleThread.last_inbound_at.getTime() < Date.now() - sla * 3600000,
      },
      messages: messages.map((m) => ({
        ...m,
        mdn_decision: decisions.find((d) => d.message_id_header === m.message_id_header) ?? null,
        read_receipts: receipts.filter((receipt) => receipt.original_message_id === m.id),
        attachments: attachments.filter((a) => a.message_id === m.id),
        sent_by: m.sent_by_user_id ? { id: m.sent_by_user_id, full_name: m.sent_by_name } : null,
      })),
      cid_map: Object.fromEntries(
        attachments
          .filter((a) => a.content_id && a.security.access_allowed)
          .map((a) => [a.content_id, a.id]),
      ),
      labels: await r.db
        .selectFrom('thread_personal_labels as tl')
        .innerJoin('personal_labels as l', 'l.id', 'tl.label_id')
        .select(['l.id', 'l.name', 'l.color', 'l.scope'])
        .where('tl.tenant_id', '=', c.tenantId)
        .where((eb) => eb.or([eb('l.scope', '=', 'tenant'), eb('l.user_id', '=', c.userId)]))
        .where('tl.thread_id', '=', thread.id)
        .where(
          sql<boolean>`(l.mailbox_mode='all' or exists(select 1 from label_mailboxes lm where lm.label_id=l.id and lm.mailbox_id=${thread.mailbox_id} and lm.tenant_id=l.tenant_id))`,
        )
        .orderBy(sql`(l.scope='tenant')`, 'desc')
        .orderBy('l.name')
        .execute(),
      is_pinned: thread.is_pinned_global || (state?.is_pinned ?? false),
      is_pinned_personal: state?.is_pinned ?? false,
      is_pinned_global: thread.is_pinned_global,
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
        .where('o.mdn_original_message_id', 'is', null)
        .orderBy('o.send_after')
        .execute(),
      my_role: role,
      delegated,
      mailbox: {
        ...box,
        role,
        permissions: delegated ? ['read', 'send', 'note', 'queue'] : undefined,
      },
    };
  });
  for (const action of ['read', 'unread', 'pin'] as const)
    app.post('/api/threads/:id/' + action, async (req) => {
      const { thread, c } = await requireThread(req.ctx, r, idOf(req.params));
      if (
        action === 'pin' &&
        z
          .object({ scope: z.enum(['personal', 'mailbox']).default('personal') })
          .parse(req.body ?? {}).scope === 'mailbox'
      ) {
        await requireMailboxPerm(c, r.db, thread.mailbox_id, 'rules');
        const result = await r.db
          .updateTable('threads')
          .set({ is_pinned_global: sql`not is_pinned_global` })
          .where('id', '=', thread.id)
          .where('tenant_id', '=', c.tenantId)
          .returning('is_pinned_global')
          .executeTakeFirstOrThrow();
        mailEvents(r, thread.mailbox_id, [thread.id]);
        return result;
      }
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
        global_add: labelIdsSchema.shape.global_add,
        global_remove: labelIdsSchema.shape.global_remove,
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
        await replaceLabels(trx, c, ids, labels, b.global_add, b.global_remove);
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
    if (b.action === 'labels' && (b.global_add.length || b.global_remove.length))
      r.io.to('tenant:' + c.tenantId).emit('labels:changed', {});
    return { updated: ids.length };
  });
  app.post('/api/mailboxes/:id/messages/actions', async (req, reply) => {
    const id = idOf(req.params),
      c = requireTenant(req.ctx);
    await requireMailboxPerm(c, r.db, id, 'organize');
    const b = z
      .object({
        type: z.enum(['move', 'delete', 'restore', 'set_flag', 'spam']),
        message_ids: z.array(z.uuid()).min(1).max(1000).optional(),
        thread_ids: z.array(z.uuid()).min(1).max(100).optional(),
        target_folder_id: z.uuid().optional(),
        target_mailbox_id: z.uuid().optional(),
        flagged: z.boolean().optional(),
        trash_folder_id: z.uuid().optional(),
      })
      .refine((b) =>
        b.trash_folder_id
          ? b.type === 'delete' && !b.message_ids && !b.thread_ids
          : !!(b.message_ids || b.thread_ids),
      )
      .parse(req.body);
    if (b.type === 'move' && !b.target_folder_id) throw conflict('Escolha a pasta de destino.');
    if (b.type === 'move' && b.target_mailbox_id && b.target_mailbox_id !== id)
      return reply
        .code(202)
        .send(
          await queueMailboxTransfer(
            r,
            req.ctx,
            id,
            { ...b, target_folder_id: b.target_folder_id!, target_mailbox_id: b.target_mailbox_id },
            req.id,
          ),
        );
    await requireMailboxPerm(
      c,
      r.db,
      id,
      b.type === 'set_flag' ? 'flag' : b.type === 'spam' ? 'move' : b.type,
    );
    if (b.type === 'spam') await requireMailboxPerm(c, r.db, id, 'rules');
    if (b.type === 'set_flag' && b.flagged === undefined)
      throw conflict('Informe o estado da sinalização.');
    const action = await r.db.transaction().execute(async (trx) => {
      let retentionDays = 30;
      if (b.type === 'delete') {
        await lockStorageTenant(trx, c.tenantId);
        const live = await trx
          .selectFrom('mailboxes')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where('id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (!live) throw notFound();
        retentionDays = (
          await trx
            .selectFrom('tenants')
            .select('mail_retention_days')
            .where('id', '=', c.tenantId)
            .executeTakeFirstOrThrow()
        ).mail_retention_days;
      }
      if (b.type === 'spam')
        await sql`select pg_advisory_xact_lock(hashtextextended(${`spam:${c.tenantId}:${id}`},0))`.execute(
          trx,
        );
      let query = trx
        .selectFrom('messages')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', id)
        .where('deleted_at', 'is', null);
      if (b.trash_folder_id) {
        await requireFolder(c, trx, id, b.trash_folder_id);
        const trash = await trx
          .selectFrom('folders')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', id)
          .where('id', '=', b.trash_folder_id)
          .where('special_use', '=', 'trash')
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (!trash) throw notFound();
        query = query
          .where('folder_id', '=', trash.id)
          .where('pending_action', '=', false)
          .limit(1001);
      } else if (b.message_ids) query = query.where('id', 'in', b.message_ids);
      else query = query.where('thread_id', 'in', b.thread_ids!);
      const scope = await readableFolders(c, trx, id);
      if (scope !== null) query = query.where(folderPredicate(scope));
      query = query.where(
        operatorThreadPredicate(c.tenantId, c.userId, sql`thread_id`, sql`mailbox_id`),
      );
      let messages = await query.orderBy('id').forUpdate().execute();
      if (b.trash_folder_id && !messages.length) return null;
      const hasMore = !!b.trash_folder_id && messages.length > 1000;
      if (hasMore) messages = messages.slice(0, 1000);
      if (messages.length > 1000) throw conflict('Selecione até 1.000 mensagens por operação.');
      if (!messages.length || (b.message_ids && messages.length !== b.message_ids.length))
        throw notFound();
      if (b.thread_ids && new Set(messages.map((m) => m.thread_id)).size !== b.thread_ids.length)
        throw notFound();
      const folders = await trx
        .selectFrom('folders')
        .select(['id', 'special_use', 'uidvalidity', 'is_local'])
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', id)
        .where('deleted_at', 'is', null)
        .execute();
      if (b.type === 'restore') {
        const trashIds = new Set(
          folders.filter((folder) => folder.special_use === 'trash').map((folder) => folder.id),
        );
        const trashed = messages.filter(
          (message) => message.folder_id && trashIds.has(message.folder_id),
        );
        if (
          !trashed.length ||
          (b.message_ids && trashed.length !== messages.length) ||
          (b.thread_ids &&
            new Set(trashed.map((message) => message.thread_id)).size !== b.thread_ids.length)
        )
          throw conflict('Somente mensagens na Lixeira podem ser restauradas.');
        messages = trashed;
      }
      if (messages.some((m) => m.pending_action))
        throw conflict('Aguarde a alteração anterior terminar.');
      if (b.type === 'spam') {
        if (
          messages.some(
            (m) =>
              m.direction !== 'inbound' ||
              m.is_mdn ||
              !z.email().safeParse(m.from_address.trim()).success,
          )
        )
          throw conflict(
            'Selecione e-mails recebidos com um remetente válido para marcar como spam.',
          );
        const scope = await readableFolders(c, trx, id);
        if (scope !== null && messages.some((m) => !m.folder_id || !scope.includes(m.folder_id)))
          throw notFound();
      }
      const destination =
        b.type === 'move'
          ? folders.find((f) => f.id === b.target_folder_id)
          : folders.find(
              (f) =>
                f.special_use ===
                (b.type === 'spam' ? 'junk' : b.type === 'restore' ? 'inbox' : 'trash'),
            );
      if (b.type !== 'set_flag' && !destination)
        throw conflict('A pasta de destino ainda não está disponível nesta caixa.');
      if (destination && !b.trash_folder_id) await requireFolder(c, trx, id, destination.id);
      if (b.type === 'spam') {
        await rememberSpamSenders(
          trx,
          c,
          id,
          destination!.id,
          messages.map((m) => m.from_address),
        );
      }
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
          type: b.type === 'spam' ? 'move' : b.type,
          payload: asJson(payload),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      const deletedAt = new Date();
      for (const m of messages) {
        const source = folders.find((folder) => folder.id === m.folder_id);
        const retained = b.type === 'delete' && source?.special_use === 'trash';
        const remote = retained && m.source_kind === 'imap' && !source.is_local;
        await audit(trx, {
          tenantId: c.tenantId,
          actorId: c.userId,
          action: 'message.' + b.type + '_requested',
          entityType: retained ? 'retained_message' : 'message',
          entityId: m.id,
          metadata: {
            mailbox_id: id,
            operation_id: row.id,
            outcome: 'requested',
            retained,
            previous_folder_id: m.folder_id,
            target_folder_id: destination?.id ?? null,
            flagged: b.flagged ?? null,
          },
          ip: c.ip,
          requestId: req.id,
          eventKey: row.id + ':' + m.id + ':requested',
        });
        await trx
          .updateTable('messages')
          .set({
            pending_action: true,
            ...(b.type === 'set_flag'
              ? { is_flagged: b.flagged }
              : { folder_id: destination!.id, imap_uid: null }),
            ...(retained
              ? {
                  deleted_at: deletedAt,
                  retention_expires_at: retentionExpiry(deletedAt, retentionDays),
                  retention_deleted_by: c.userId,
                  ...(remote
                    ? {
                        retention_imap_folder_id: source.id,
                        retention_imap_uid: m.imap_uid,
                        retention_imap_uidvalidity: source.uidvalidity,
                      }
                    : {}),
                }
              : {}),
          })
          .where('id', '=', m.id)
          .execute();
      }
      const ids = messages.map((m) => m.thread_id);
      await touchThreads(trx, ids, 'manual', c.userId);
      return { id: row.id, ids, affected: messages.length, hasMore };
    });
    if (!action) return reply.code(202).send({ affected: 0, has_more: false });
    await r.queues['mail-actions']
      .add(
        'action',
        { action_id: action.id },
        {
          jobId: toBullJobId('action:' + action.id),
          attempts: 3,
          backoff: { type: 'exponential', delay: 10000 },
        },
      )
      .catch(() =>
        app.log.warn({ action_id: action.id }, 'Operação persistida; o agendador retomará.'),
      );
    mailEvents(r, id, action.ids);
    return reply
      .code(202)
      .send({ action_id: action.id, affected: action.affected, has_more: action.hasMore });
  });
  const readableAttachment = async (ctx: RequestContext | null, id: string) => {
    const c = requireTenant(ctx);
    const a = await r.db
      .selectFrom('attachments as a')
      .innerJoin('messages as m', 'm.id', 'a.message_id')
      .selectAll('a')
      .where('a.id', '=', id)
      .where('a.tenant_id', '=', c.tenantId)
      .where('m.deleted_at', 'is', null)
      .executeTakeFirst();
    if (!a) throw notFound();
    const message = await r.db
      .selectFrom('messages')
      .select(['folder_id', 'thread_id'])
      .where('id', '=', a.message_id)
      .executeTakeFirstOrThrow();
    await requireThread(c, r, message.thread_id);
    const attachmentScope = await readableThreadFolders(c, r.db, a.mailbox_id, message.thread_id);
    if (
      attachmentScope !== null &&
      (!message.folder_id || !attachmentScope.includes(message.folder_id))
    )
      throw notFound();
    return a;
  };
  app.get('/api/attachments/:id/security', async (req, reply) => {
    const file = await readableAttachment(req.ctx, idOf(req.params));
    const security = await securityForFiles(r.db, [file.storage_path]);
    reply.header('Cache-Control', 'private, no-store');
    return securitySummary(security.get(file.storage_path) ?? null);
  });
  for (const kind of ['download', 'inline'] as const)
    app.get('/api/attachments/:id/' + kind, async (req, reply) => {
      const a = await readableAttachment(req.ctx, idOf(req.params));
      if (
        kind === 'inline' &&
        !/^(image\/(png|jpeg|gif|webp)|application\/pdf)$/.test(a.content_type)
      )
        throw notFound();
      await assertFilesClean(r.db, [a.storage_path], new Storage(r.env.STORAGE_DIR, r.db));
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
      return reply.send(await new Storage(r.env.STORAGE_DIR, r.db).openReadStream(a.storage_path));
    });
}
