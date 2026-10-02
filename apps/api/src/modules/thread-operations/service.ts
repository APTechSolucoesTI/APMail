import { sql } from 'kysely';
import {
  assignThread,
  audit,
  mailboxUserCan,
  userCanReadThread,
  recomputeThreadStatus,
  threadNotification,
} from '@apmail/db';
import { noteMentions, threadNoteSchema, type MailboxPerm } from '@apmail/shared';
import {
  requireTenant,
  conflict,
  forbidden,
  notFound,
  type RequestContext,
} from '../../authz/context.js';
import { requireMailboxPerm } from '../../authz/guards.js';
import { requireThread, mailEvents } from '../mail.js';
import type { Resources } from '../resources.js';
export async function changeThread(
  r: Resources,
  ctx: RequestContext | null,
  id: string,
  action: 'done' | 'reopen' | 'excluded' | 'assign',
  value?: boolean | string | null,
) {
  const perm: MailboxPerm =
    action === 'assign' ? (value === ctx?.userId ? 'assign_self' : 'assign_others') : 'queue';
  const { thread, c } = await requireThread(ctx, r, id, perm);
  if (
    action === 'assign' &&
    typeof value === 'string' &&
    !(await userCanReadThread(r.db, c.tenantId, thread.mailbox_id, value, id))
  )
    throw conflict('Escolha um responsável com acesso às pastas desta conversa.');
  if (
    action === 'assign' &&
    value &&
    !(await mailboxUserCan(r.db, c.tenantId, thread.mailbox_id, value as string, 'send'))
  )
    throw conflict('Escolha um responsável com permissão de envio nesta caixa.');
  const notification = await r.db.transaction().execute(async (tx) => {
    if (action === 'assign') return assignThread(tx, id, value as string | null, c.userId);
    await tx
      .updateTable('threads')
      .set(
        action === 'done'
          ? { manual_done_at: new Date() }
          : action === 'reopen'
            ? { manual_done_at: null, queue_excluded: false, history_queue_eligible: true }
            : { queue_excluded: value as boolean },
      )
      .where('id', '=', id)
      .execute();
    await recomputeThreadStatus(tx, id, 'manual', c.userId);
    await audit(tx, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'thread.' + action,
      entityType: 'thread',
      entityId: id,
    });
    return null;
  });
  if (notification)
    r.io.to('user:' + notification.user_id).emit('notification:new', { notification });
  mailEvents(r, thread.mailbox_id, [id]);
  return { ok: true };
}
export async function bulkQueue(
  r: Resources,
  ctx: RequestContext | null,
  mailboxId: string,
  ids: string[],
  action: 'done' | 'reopen' | 'assign',
  userId: string | null,
) {
  const c = requireTenant(ctx);
  for (const id of ids) await requireThread(c, r, id);
  if (action === 'assign' && userId)
    for (const id of ids)
      if (!(await userCanReadThread(r.db, c.tenantId, mailboxId, userId, id)))
        throw conflict('Escolha um responsável com acesso às pastas selecionadas.');
  await requireMailboxPerm(
    c,
    r.db,
    mailboxId,
    action === 'assign' ? (userId === c.userId ? 'assign_self' : 'assign_others') : 'queue',
  );
  if (
    userId &&
    action === 'assign' &&
    !(await mailboxUserCan(r.db, c.tenantId, mailboxId, userId, 'send'))
  )
    throw conflict('Escolha um responsável com permissão de envio nesta caixa.');
  const notifications = await r.db.transaction().execute(async (tx) => {
    const rows = await tx
      .selectFrom('threads')
      .select('id')
      .where('id', 'in', ids)
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', mailboxId)
      .where('deleted_at', 'is', null)
      .orderBy('id')
      .forUpdate()
      .execute();
    if (rows.length !== ids.length) throw notFound();
    const result = [];
    for (const row of rows) {
      if (action === 'assign') {
        const n = await assignThread(tx, row.id, userId, c.userId);
        if (n) result.push(n);
      } else {
        await tx
          .updateTable('threads')
          .set(
            action === 'done'
              ? { manual_done_at: new Date() }
              : { manual_done_at: null, queue_excluded: false, history_queue_eligible: true },
          )
          .where('id', '=', row.id)
          .execute();
        await recomputeThreadStatus(tx, row.id, 'manual', c.userId);
        await audit(tx, {
          tenantId: c.tenantId,
          actorId: c.userId,
          action: 'thread.' + action,
          entityType: 'thread',
          entityId: row.id,
        });
      }
    }
    return result;
  });
  for (const notification of notifications)
    r.io.to('user:' + notification.user_id).emit('notification:new', { notification });
  mailEvents(r, mailboxId, ids);
  return { updated: ids.length };
}
export async function threadHistory(r: Resources, ctx: RequestContext | null, id: string) {
  const { c } = await requireThread(ctx, r, id);
  const statuses = await r.db
    .selectFrom('thread_status_history as h')
    .leftJoin('users as u', 'u.id', 'h.changed_by')
    .select([
      'h.id',
      'h.from_status',
      'h.to_status',
      'h.reason',
      'h.created_at',
      'u.full_name as changed_by_name',
    ])
    .where('h.tenant_id', '=', c.tenantId)
    .where('h.thread_id', '=', id)
    .execute();
  const assignments = await r.db
    .selectFrom('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.actor_id')
    .leftJoin('users as target', (j) =>
      j.on('target.id', '=', sql<string>`(a.metadata->>'to_user_id')::uuid`),
    )
    .select([
      'a.id',
      'a.created_at',
      'a.metadata',
      'u.full_name as changed_by_name',
      'target.full_name as assigned_to_name',
    ])
    .where('a.tenant_id', '=', c.tenantId)
    .where('a.entity_id', '=', id)
    .where('a.action', '=', 'thread.assigned')
    .execute();
  return [
    ...statuses.map((s) => ({ ...s, type: 'status' as const })),
    ...assignments.map((a) => ({ ...a, id: String(a.id), type: 'assignment' as const })),
  ].sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
}
export async function threadNotes(r: Resources, ctx: RequestContext | null, id: string) {
  const { c } = await requireThread(ctx, r, id);
  return r.db
    .selectFrom('thread_notes as n')
    .innerJoin('users as u', 'u.id', 'n.author_id')
    .select([
      'n.id',
      'n.body',
      'n.mentioned_user_ids',
      'n.created_at',
      'n.updated_at',
      'n.author_id',
      'u.full_name as author_name',
      sql<
        string | null
      >`case when u.avatar_path is not null then '/api/avatars/'||u.id||'?v='||extract(epoch from u.updated_at)::bigint else null end`.as(
        'avatar_url',
      ),
    ])
    .where('n.thread_id', '=', id)
    .where('n.tenant_id', '=', c.tenantId)
    .where('n.deleted_at', 'is', null)
    .orderBy('n.created_at')
    .orderBy('n.id')
    .execute();
}
export async function saveNote(
  r: Resources,
  ctx: RequestContext | null,
  threadId: string,
  body: unknown,
  noteId?: string,
) {
  const { thread, c } = await requireThread(ctx, r, threadId, 'note');
  const b = threadNoteSchema.parse(body),
    mentions = [...new Set(noteMentions(b.body).map((m) => m.user_id))];
  const allowed: string[] = [];
  for (const userId of mentions)
    if (await userCanReadThread(r.db, c.tenantId, thread.mailbox_id, userId, thread.id))
      allowed.push(userId);
  const result = await r.db.transaction().execute(async (tx) => {
    const previous = noteId
      ? await tx
          .selectFrom('thread_notes')
          .selectAll()
          .where('id', '=', noteId)
          .where('tenant_id', '=', c.tenantId)
          .where('thread_id', '=', threadId)
          .where('deleted_at', 'is', null)
          .forUpdate()
          .executeTakeFirst()
      : null;
    if (noteId && !previous) throw notFound();
    if (
      previous &&
      (previous.author_id !== c.userId || Date.now() - previous.created_at.getTime() > 900000)
    )
      throw forbidden();
    const note = previous
      ? await tx
          .updateTable('thread_notes')
          .set({ body: b.body, mentioned_user_ids: allowed })
          .where('id', '=', noteId!)
          .returningAll()
          .executeTakeFirstOrThrow()
      : await tx
          .insertInto('thread_notes')
          .values({
            tenant_id: c.tenantId,
            mailbox_id: thread.mailbox_id,
            thread_id: threadId,
            author_id: c.userId,
            body: b.body,
            mentioned_user_ids: allowed,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
    const notifications = [];
    for (const userId of allowed.filter((u) => !previous?.mentioned_user_ids.includes(u))) {
      const n = await threadNotification(tx, {
        tenantId: c.tenantId,
        mailboxId: thread.mailbox_id,
        threadId,
        actorId: c.userId,
        userId,
        type: 'mention',
        title: 'Você foi mencionado em uma nota',
        body: thread.subject || '(sem assunto)',
      });
      if (n) notifications.push(n);
    }
    return { note, notifications };
  });
  for (const notification of result.notifications)
    r.io.to('user:' + notification.user_id).emit('notification:new', { notification });
  r.io.to('thread:' + threadId).emit('thread:notes-changed', { thread_id: threadId });
  return result.note;
}
export async function noteThread(r: Resources, ctx: RequestContext | null, id: string) {
  const c = requireTenant(ctx),
    note = await r.db
      .selectFrom('thread_notes')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
  if (!note) throw notFound();
  await requireThread(c, r, note.thread_id, 'note');
  if (note.author_id !== c.userId || Date.now() - note.created_at.getTime() > 900000)
    throw forbidden();
  return note;
}
export async function deleteNote(r: Resources, ctx: RequestContext | null, id: string) {
  const note = await noteThread(r, ctx, id);
  const removed = await r.db
    .updateTable('thread_notes')
    .set({ deleted_at: new Date() })
    .where('id', '=', id)
    .where('author_id', '=', note.author_id)
    .where('deleted_at', 'is', null)
    .where('created_at', '>=', new Date(Date.now() - 900000))
    .returning('id')
    .executeTakeFirst();
  if (!removed) throw forbidden();
  r.io.to('thread:' + note.thread_id).emit('thread:notes-changed', { thread_id: note.thread_id });
  return { ok: true };
}
