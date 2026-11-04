import { z } from 'zod';
import { UnrecoverableError } from 'bullmq';
import {
  touchThreads,
  asJson,
  audit,
  lockStorageTenant,
  registerSecurityFile,
  enqueueSecurityScan,
} from '@apmail/db';
import type { WorkerResources } from '../resources.js';
import { transports } from '../imap/connect.js';
import { withMailboxLock } from '../lib/mailbox-lock.js';
import { emitThreads } from '../lib/events.js';
import { markMailboxError } from './mailbox-health.js';
import { isConnectionError } from '../lib/errors.js';
import { handleFolderAction } from './folder-actions.js';
import { userCanMailbox } from '../lib/mailbox-permissions.js';
import { handleMailboxTransfer } from './mail-transfer.js';
export const actionPayloadSchema = z.object({
  message_ids: z.array(z.uuid()).max(1000),
  target_folder_id: z.uuid().optional(),
  previous_folder_ids: z.record(z.string(), z.string().nullable()),
  previous_flags: z.record(z.string(), z.boolean()).default({}),
  previous_uids: z.record(z.string(), z.string().nullable()).default({}),
  flagged: z.boolean().optional(),
});
export async function handleMailAction(
  r: WorkerResources,
  actionId: string,
  jobId: string,
  lastAttempt: boolean,
) {
  const initial = await r.db
    .selectFrom('mail_actions')
    .selectAll()
    .where('id', '=', actionId)
    .where('status', 'in', ['pending', 'processing'])
    .executeTakeFirst();
  if (!initial) return;
  const tenant = await r.db
    .selectFrom('tenants')
    .select('id')
    .where('id', '=', initial.tenant_id)
    .where('deleted_at', 'is', null)
    .where('suspended_at', 'is', null)
    .executeTakeFirst();
  if (!tenant) return;
  if (
    initial.type === 'move' &&
    z.object({ cross_mailbox: z.literal(true) }).safeParse(initial.payload).success
  )
    return handleMailboxTransfer(r, initial, jobId, lastAttempt);
  if (['create_folder', 'rename_folder', 'delete_folder'].includes(initial.type))
    return handleFolderAction(r, initial, jobId, lastAttempt);
  const result = await withMailboxLock(
    r.redis,
    initial.mailbox_id,
    jobId,
    async () => {
      const action = await r.db
        .selectFrom('mail_actions')
        .selectAll()
        .where('id', '=', actionId)
        .where('status', 'in', ['pending', 'processing'])
        .executeTakeFirst();
      if (!action) return;
      const box = await r.db
        .selectFrom('mailboxes')
        .selectAll()
        .where('id', '=', action.mailbox_id)
        .where('tenant_id', '=', action.tenant_id)
        .where('deleted_at', 'is', null)
        .executeTakeFirstOrThrow();
      const payload = actionPayloadSchema.parse(action.payload);
      let t: Awaited<ReturnType<typeof transports>> | undefined;
      const threadIds = new Set<string>();
      try {
        if (
          action.requested_by &&
          (await r.db
            .selectFrom('platform_admins')
            .select('user_id')
            .where('user_id', '=', action.requested_by)
            .executeTakeFirst())
        )
          throw new UnrecoverableError('O superadmin não pode organizar mensagens.');
        if (box.status !== 'active')
          throw new Error('Caixa indisponível. Reconecte antes de organizar mensagens.');
        if (
          action.requested_by &&
          !(await userCanMailbox(
            r,
            box,
            action.requested_by,
            action.type === 'set_flag'
              ? 'flag'
              : action.type === 'delete'
                ? 'delete'
                : action.type === 'restore'
                  ? 'restore'
                  : 'move',
          ))
        )
          throw new UnrecoverableError('A permissão para organizar mensagens foi removida.');
        await r.db
          .updateTable('mail_actions')
          .set({ status: 'processing', attempts: action.attempts + 1 })
          .where('id', '=', action.id)
          .execute();
        const messages = await r.db
          .selectFrom('messages')
          .selectAll()
          .where('id', 'in', payload.message_ids)
          .where('tenant_id', '=', box.tenant_id)
          .where('mailbox_id', '=', box.id)
          .where('pending_action', '=', true)
          .execute();
        if (box.receiving_protocol === 'imap' && messages.some((m) => m.source_kind === 'imap')) {
          t = await transports(r.db, box, r.env);
          await t.imap.connect();
        }
        for (const m of messages) {
          threadIds.add(m.thread_id);
          const sourceId = payload.previous_folder_ids[m.id];
          const source = sourceId
            ? await r.db
                .selectFrom('folders')
                .selectAll()
                .where('id', '=', sourceId)
                .where('mailbox_id', '=', box.id)
                .executeTakeFirst()
            : null;
          const sourceUid = payload.previous_uids[m.id] ?? m.imap_uid;
          const removeFromTrash =
            action.type === 'delete' &&
            (m.retention_expires_at !== null || source?.special_use === 'trash');
          if (box.receiving_protocol !== 'imap' || m.source_kind !== 'imap' || source?.is_local) {
            await r.db
              .updateTable('messages')
              .set({
                pending_action: false,
                ...(removeFromTrash ? { deleted_at: m.deleted_at ?? new Date() } : {}),
              })
              .where('id', '=', m.id)
              .where('tenant_id', '=', box.tenant_id)
              .execute();
            continue;
          }
          if (!t || !source || !sourceUid)
            throw new Error('Mensagem ainda não está disponível no servidor.');
          const sourceLock = await t.imap.getMailboxLock(source.imap_path);
          let newUid: number | null = Number(sourceUid),
            deleted = false;
          const destination =
            action.type === 'set_flag'
              ? null
              : await r.db
                  .selectFrom('folders')
                  .selectAll()
                  .where('id', '=', m.folder_id!)
                  .where('mailbox_id', '=', box.id)
                  .where('deleted_at', 'is', null)
                  .executeTakeFirst();
          try {
            if (
              m.retention_expires_at &&
              (!t.imap.mailbox ||
                String(t.imap.mailbox.uidValidity) !== m.retention_imap_uidvalidity)
            )
              throw new UnrecoverableError(
                'A identidade da pasta IMAP mudou. A cópia local foi preservada.',
              );
            const present = await t.imap.search({ uid: String(sourceUid) }, { uid: true });
            const exists = Array.isArray(present) && present.includes(Number(sourceUid));
            if (action.type === 'set_flag') {
              if (!exists) throw new Error('Mensagem não encontrada no servidor.');
              if (payload.flagged)
                await t.imap.messageFlagsAdd([Number(sourceUid)], ['\\Flagged'], { uid: true });
              else
                await t.imap.messageFlagsRemove([Number(sourceUid)], ['\\Flagged'], { uid: true });
            } else if (removeFromTrash) {
              if (exists && m.retention_expires_at) {
                const files = await r.db
                  .selectFrom('attachments')
                  .select('storage_path')
                  .where('tenant_id', '=', box.tenant_id)
                  .where('message_id', '=', m.id)
                  .execute();
                for (const file of files)
                  if (!(await r.storage.inspect(file.storage_path))?.isFile())
                    throw new Error('Um anexo da cópia local não está disponível.');
                // Oversized IMAP messages were indexed without their MIME body. Stream the
                // original into durable storage before expunging the provider's only full copy.
                if (
                  m.size_bytes > 50 * 1024 * 1024 &&
                  (!m.raw_storage_path || !(await r.storage.inspect(m.raw_storage_path))?.isFile())
                ) {
                  const path = `mail-raw/${box.tenant_id}/${box.id}/${m.id}.eml`;
                  const { content } = await t.imap.download(String(sourceUid), undefined, {
                    uid: true,
                  });
                  if (!content) throw new Error('O servidor não retornou a mensagem original.');
                  const scan = await r.db.transaction().execute(async (tx) => {
                    await lockStorageTenant(tx, box.tenant_id);
                    await r.storage.withDatabase(tx).writeFile(path, content);
                    const stored = await r.storage.inspect(path);
                    if (!stored?.isFile() || Number(stored.size) < m.size_bytes)
                      throw new Error('A cópia da mensagem IMAP está incompleta.');
                    await tx
                      .updateTable('messages')
                      .set({ raw_storage_path: path })
                      .where('tenant_id', '=', box.tenant_id)
                      .where('id', '=', m.id)
                      .execute();
                    return registerSecurityFile(tx, {
                      storage_key: path,
                      tenant_id: box.tenant_id,
                      mailbox_id: box.id,
                      message_id: m.id,
                      resource_id: m.id,
                      filename: 'message.eml',
                      content_type: 'message/rfc822',
                      size_bytes: Number(stored.size),
                      kind: 'mail_raw',
                    });
                  });
                  await enqueueSecurityScan(r.queues['antivirus-scan'], scan).catch(
                    () => undefined,
                  );
                }
              }
              if (exists) {
                const capabilities = t.imap.capabilities;
                const uidExpunge =
                  capabilities.has('UIDPLUS') ||
                  t.imap.enabled.has('IMAP4REV2') ||
                  (capabilities.has('IMAP4rev2') && !capabilities.has('IMAP4rev1'));
                // Without UID EXPUNGE the client can remove unrelated messages marked Deleted.
                if (!uidExpunge)
                  throw new UnrecoverableError(
                    'O servidor IMAP não oferece exclusão segura por UID.',
                  );
                if (!(await t.imap.messageDelete([Number(sourceUid)], { uid: true })))
                  throw new Error('O servidor IMAP não confirmou a exclusão.');
              }
              deleted = true;
            } else {
              if (!destination) throw new Error('Pasta de destino indisponível.');
              if (exists) {
                const move = await t.imap.messageMove([Number(sourceUid)], destination.imap_path, {
                  uid: true,
                });
                newUid = move ? (move.uidMap?.get(Number(sourceUid)) ?? null) : null;
              } else newUid = null;
            }
          } finally {
            sourceLock.release();
          }
          // Recupera movimento concluído no IMAP antes de uma eventual interrupção do job.
          if (newUid === null && destination) {
            const lock = await t.imap.getMailboxLock(destination.imap_path);
            try {
              const matches = await t.imap.search(
                { header: { 'Message-ID': m.message_id_header } },
                { uid: true },
              );
              if (Array.isArray(matches) && matches.length) newUid = matches.at(-1)!;
            } finally {
              lock.release();
            }
          }
          await r.db
            .updateTable('messages')
            .set({
              pending_action: false,
              imap_uid: newUid,
              ...(deleted ? { deleted_at: m.deleted_at ?? new Date() } : {}),
            })
            .where('id', '=', m.id)
            .execute();
        }
        await r.db.transaction().execute(async (trx) => {
          const completed = await trx
            .selectFrom('messages')
            .select(['id', 'retention_expires_at'])
            .where('tenant_id', '=', action.tenant_id)
            .where('mailbox_id', '=', action.mailbox_id)
            .where('id', 'in', payload.message_ids)
            .execute();
          for (const m of completed)
            await audit(trx, {
              tenantId: action.tenant_id,
              actorId: action.requested_by,
              action:
                (
                  {
                    delete: 'message.deleted',
                    move: 'message.moved',
                    restore: 'message.restored',
                    set_flag: 'message.flagged',
                  } as Record<string, string>
                )[action.type] ?? 'message.organized',
              entityType: m.retention_expires_at ? 'retained_message' : 'message',
              entityId: m.id,
              metadata: {
                mailbox_id: action.mailbox_id,
                operation_id: action.id,
                outcome: 'completed',
                target_folder_id: payload.target_folder_id ?? null,
              },
              eventKey: action.id + ':' + m.id + ':completed',
            });
          await trx
            .updateTable('mail_actions')
            .set({ status: 'done', processed_at: new Date(), last_error: null })
            .where('id', '=', action.id)
            .execute();
          await touchThreads(trx, [...threadIds], 'manual', action.requested_by);
        });
        emitThreads(r, box.id, [...threadIds]);
      } catch (error) {
        if (isConnectionError(error)) await markMailboxError(r, box, error);
        if (lastAttempt || error instanceof UnrecoverableError) {
          const last_error =
            'Não foi possível aplicar toda a alteração no servidor. Mensagens já retidas continuam preservadas no APMail.';
          await r.db.transaction().execute(async (trx) => {
            await audit(trx, {
              tenantId: action.tenant_id,
              actorId: action.requested_by,
              action: 'mail_action.failed',
              entityType: 'mailbox',
              entityId: action.mailbox_id,
              metadata: {
                operation_id: action.id,
                outcome: 'failed',
                message_ids: payload.message_ids,
                reason: last_error,
              },
              eventKey: action.id + ':failed',
            });
            const pending = await trx
              .selectFrom('messages')
              .select(['id', 'thread_id', 'retention_expires_at'])
              .where('id', 'in', payload.message_ids)
              .where('tenant_id', '=', box.tenant_id)
              .where('pending_action', '=', true)
              .execute();
            for (const m of pending) {
              threadIds.add(m.thread_id);
              if (m.retention_expires_at) {
                await trx
                  .updateTable('messages')
                  .set({
                    pending_action: false,
                    retention_last_error:
                      'A cópia foi preservada. A exclusão no servidor de origem não foi confirmada.',
                  })
                  .where('tenant_id', '=', box.tenant_id)
                  .where('id', '=', m.id)
                  .execute();
                continue;
              }
              await trx
                .updateTable('messages')
                .set({
                  folder_id: payload.previous_folder_ids[m.id] ?? null,
                  imap_uid: payload.previous_uids[m.id] ?? null,
                  is_flagged: payload.previous_flags[m.id] ?? false,
                  pending_action: false,
                  deleted_at: null,
                })
                .where('id', '=', m.id)
                .execute();
            }
            await trx
              .updateTable('mail_actions')
              .set({ status: 'failed', processed_at: new Date(), last_error })
              .where('id', '=', action.id)
              .execute();
            await touchThreads(trx, [...threadIds], 'sync', action.requested_by);
            if (action.requested_by) {
              const notification = await trx
                .insertInto('notifications')
                .values({
                  tenant_id: box.tenant_id,
                  user_id: action.requested_by,
                  type: 'action_failed',
                  title: 'Não foi possível organizar mensagens na caixa ' + box.name,
                  body: last_error,
                  link: '/mail/' + box.id,
                  payload: asJson({ action_id: action.id }),
                })
                .returningAll()
                .executeTakeFirstOrThrow();
              r.io.to('user:' + action.requested_by).emit('notification:new', { notification });
            }
          });
          emitThreads(r, box.id, [...threadIds]);
        }
        throw error;
      } finally {
        await t?.close();
      }
    },
    30000,
  );
  if (result === 'skipped') throw new Error('Caixa ocupada. A operação será tentada novamente.');
}
