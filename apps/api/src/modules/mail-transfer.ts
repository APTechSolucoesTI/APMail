import { randomUUID } from 'node:crypto';
import { asJson, audit } from '@apmail/db';
import { toBullJobId } from '@apmail/shared';
import { requireTenant, conflict, notFound, type RequestContext } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import { readableFolders, requireFolder } from '../authz/folders.js';
import type { Resources } from './resources.js';

export async function queueMailboxTransfer(
  r: Resources,
  context: RequestContext | null,
  sourceId: string,
  input: {
    message_ids?: string[];
    thread_ids?: string[];
    target_mailbox_id: string;
    target_folder_id: string;
  },
  requestId: string,
) {
  const c = requireTenant(context),
    targetId = input.target_mailbox_id;
  for (const box of [sourceId, targetId])
    for (const permission of ['read', 'organize', 'move'] as const)
      await requireMailboxPerm(c, r.db, box, permission);
  const target = await r.db
    .selectFrom('mailboxes')
    .select('status')
    .where('id', '=', targetId)
    .where('tenant_id', '=', c.tenantId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!target || target.status !== 'active')
    throw conflict('A caixa de destino precisa estar ativa.');
  const folder = await r.db
    .selectFrom('folders')
    .select('id')
    .where('id', '=', input.target_folder_id)
    .where('tenant_id', '=', c.tenantId)
    .where('mailbox_id', '=', targetId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!folder) throw notFound();
  await requireFolder(c, r.db, targetId, folder.id);
  const scope = await readableFolders(c, r.db, sourceId);
  const action = await r.db.transaction().execute(async (tx) => {
    let query = tx
      .selectFrom('messages')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', sourceId)
      .where('deleted_at', 'is', null);
    query = input.message_ids
      ? query.where('id', 'in', input.message_ids)
      : query.where('thread_id', 'in', input.thread_ids!);
    const messages = await query.orderBy('id').forUpdate().execute();
    if (
      !messages.length ||
      (input.message_ids && messages.length !== input.message_ids.length) ||
      (input.thread_ids &&
        new Set(messages.map((m) => m.thread_id)).size !== input.thread_ids.length)
    )
      throw notFound();
    if (scope !== null && messages.some((m) => !m.folder_id || !scope.includes(m.folder_id)))
      throw notFound();
    if (messages.some((m) => m.pending_action))
      throw conflict('Aguarde a movimentação anterior terminar.');
    const row = await tx
      .insertInto('mail_actions')
      .values({
        tenant_id: c.tenantId,
        mailbox_id: sourceId,
        requested_by: c.userId,
        type: 'move',
        payload: asJson({
          cross_mailbox: true,
          target_mailbox_id: targetId,
          target_folder_id: folder.id,
          message_ids: messages.map((m) => m.id),
          target_message_ids: Object.fromEntries(messages.map((m) => [m.id, randomUUID()])),
        }),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx
      .updateTable('messages')
      .set({ pending_action: true })
      .where(
        'id',
        'in',
        messages.map((m) => m.id),
      )
      .where('tenant_id', '=', c.tenantId)
      .execute();
    await audit(tx, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'message.transfer_requested',
      entityType: 'mailbox',
      entityId: sourceId,
      requestId,
      ip: c.ip,
      metadata: {
        operation_id: row.id,
        target_mailbox_id: targetId,
        target_folder_id: folder.id,
        message_ids: messages.map((m) => m.id),
      },
      eventKey: row.id + ':transfer-requested',
    });
    return { id: row.id, threadIds: [...new Set(messages.map((m) => m.thread_id))] };
  });
  await r.queues['mail-actions'].add(
    'action',
    { action_id: action.id },
    {
      jobId: toBullJobId('action:' + action.id),
      attempts: 5,
      backoff: { type: 'exponential', delay: 10000 },
    },
  );
  r.io
    .to('mailbox:' + sourceId)
    .emit('threads:changed', { mailbox_id: sourceId, thread_ids: action.threadIds });
  return { action_id: action.id };
}
