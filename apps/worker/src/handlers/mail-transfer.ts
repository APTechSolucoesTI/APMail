import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { z } from 'zod';
import { UnrecoverableError } from 'bullmq';
import { sql, type Selectable } from 'kysely';
import {
  asJson,
  audit,
  backupMime,
  assertStorageCapacity,
  lockStorageTenant,
  registerSecurityFile,
  enqueueSecurityScan,
  resolveThread,
  touchThreads,
  userCanReadFolder,
  type DB,
} from '@apmail/db';
import type { Address } from '@apmail/shared';
import type { WorkerResources } from '../resources.js';
import { transports, type Mailbox } from '../imap/connect.js';
import { withMailboxLock } from '../lib/mailbox-lock.js';
import { userCanMailbox } from '../lib/mailbox-permissions.js';
import { emitThreads } from '../lib/events.js';

const payloadSchema = z.object({
  cross_mailbox: z.literal(true),
  target_mailbox_id: z.uuid(),
  target_folder_id: z.uuid(),
  message_ids: z.array(z.uuid()).min(1),
  target_message_ids: z.record(z.string(), z.uuid()),
});
type Message = Selectable<DB['messages']>;
async function buffer(stream: Readable) {
  const chunks: Buffer[] = [];
  for await (const part of stream) chunks.push(Buffer.isBuffer(part) ? part : Buffer.from(part));
  return Buffer.concat(chunks);
}

/** Copy and verify destination before deleting source. Stable destination IDs survive retries. */
export async function handleMailboxTransfer(
  r: WorkerResources,
  initial: Selectable<DB['mail_actions']>,
  jobId: string,
  lastAttempt: boolean,
) {
  const p = payloadSchema.parse(initial.payload);
  if (initial.type !== 'move' || p.target_mailbox_id === initial.mailbox_id)
    throw new UnrecoverableError('Movimentação inválida.');
  const boxIds = [initial.mailbox_id, p.target_mailbox_id].sort();
  const result = await withMailboxLock(
    r.redis,
    boxIds[0]!,
    jobId,
    async () => {
      const inner = await withMailboxLock(
        r.redis,
        boxIds[1]!,
        jobId,
        async () => {
          const action = await r.db
            .selectFrom('mail_actions')
            .selectAll()
            .where('id', '=', initial.id)
            .where('status', 'in', ['pending', 'processing'])
            .executeTakeFirst();
          if (!action) return;
          const boxes = await r.db
            .selectFrom('mailboxes')
            .selectAll()
            .where('tenant_id', '=', action.tenant_id)
            .where('id', 'in', boxIds)
            .where('deleted_at', 'is', null)
            .execute();
          const source = boxes.find((b) => b.id === action.mailbox_id),
            target = boxes.find((b) => b.id === p.target_mailbox_id);
          let sourceTransport: Awaited<ReturnType<typeof transports>> | undefined,
            targetTransport: Awaited<ReturnType<typeof transports>> | undefined;
          const sourceThreads = new Set<string>(),
            targetThreads = new Set<string>();
          try {
            if (!source || !target || source.status !== 'active' || target.status !== 'active')
              throw new UnrecoverableError('Uma das caixas está indisponível.');
            if (
              !action.requested_by ||
              (await r.db
                .selectFrom('platform_admins')
                .select('user_id')
                .where('user_id', '=', action.requested_by)
                .executeTakeFirst())
            )
              throw new UnrecoverableError('Acesso indisponível.');
            for (const box of [source, target])
              for (const permission of ['read', 'organize', 'move'] as const)
                if (!(await userCanMailbox(r, box, action.requested_by, permission)))
                  throw new UnrecoverableError('A permissão para mover e-mails foi removida.');
            const destination = await r.db
              .selectFrom('folders')
              .selectAll()
              .where('id', '=', p.target_folder_id)
              .where('tenant_id', '=', action.tenant_id)
              .where('mailbox_id', '=', target.id)
              .where('deleted_at', 'is', null)
              .executeTakeFirst();
            if (
              !destination ||
              !(await userCanReadFolder(
                r.db,
                action.tenant_id,
                target.id,
                action.requested_by,
                destination.id,
              ))
            )
              throw new UnrecoverableError('Pasta de destino indisponível.');
            await r.db
              .updateTable('mail_actions')
              .set({ status: 'processing', attempts: action.attempts + 1 })
              .where('id', '=', action.id)
              .execute();
            const sourceImap = async () => {
              if (!sourceTransport) {
                sourceTransport = await transports(r.db, source, r.env);
                await sourceTransport.imap.connect();
              }
              return sourceTransport.imap;
            };
            const targetImap = async () => {
              if (!targetTransport) {
                targetTransport = await transports(r.db, target, r.env);
                await targetTransport.imap.connect();
              }
              return targetTransport.imap;
            };
            for (const id of p.message_ids) {
              const message = await r.db
                .selectFrom('messages')
                .selectAll()
                .where('id', '=', id)
                .where('tenant_id', '=', action.tenant_id)
                .where('mailbox_id', '=', source.id)
                .executeTakeFirstOrThrow();
              sourceThreads.add(message.thread_id);
              const targetMessageId = p.target_message_ids[id];
              if (!targetMessageId)
                throw new UnrecoverableError('Identificador de destino ausente.');
              let copied = await r.db
                .selectFrom('messages')
                .selectAll()
                .where('id', '=', targetMessageId)
                .where('tenant_id', '=', action.tenant_id)
                .where('mailbox_id', '=', target.id)
                .executeTakeFirst();
              if (
                message.deleted_at &&
                !message.pending_action &&
                copied &&
                !copied.pending_action
              ) {
                targetThreads.add(copied.thread_id);
                continue;
              }
              if (
                message.deleted_at ||
                !message.pending_action ||
                !message.folder_id ||
                !(await userCanReadFolder(
                  r.db,
                  action.tenant_id,
                  source.id,
                  action.requested_by,
                  message.folder_id,
                ))
              )
                throw new UnrecoverableError('O e-mail de origem não está disponível.');
              const sourceFolder = await r.db
                .selectFrom('folders')
                .selectAll()
                .where('id', '=', message.folder_id)
                .where('tenant_id', '=', action.tenant_id)
                .where('mailbox_id', '=', source.id)
                .executeTakeFirstOrThrow();
              const remoteSource =
                source.receiving_protocol === 'imap' &&
                message.source_kind === 'imap' &&
                !sourceFolder.is_local;
              if (!copied) {
                let raw: Buffer | undefined;
                if (remoteSource) {
                  if (!message.imap_uid)
                    throw new Error('Aguarde a sincronização do e-mail de origem.');
                  const imap = await sourceImap(),
                    lock = await imap.getMailboxLock(sourceFolder.imap_path);
                  try {
                    if (
                      sourceFolder.uidvalidity === null ||
                      !imap.mailbox ||
                      String(imap.mailbox.uidValidity) !== String(sourceFolder.uidvalidity)
                    )
                      throw new UnrecoverableError(
                        'A pasta de origem mudou no servidor. Sincronize antes de mover.',
                      );
                    const fetched = await imap.fetchOne(
                      message.imap_uid,
                      { source: true, envelope: true },
                      { uid: true },
                    );
                    if (
                      !fetched ||
                      !fetched.source ||
                      fetched.envelope?.messageId !== message.message_id_header
                    )
                      throw new Error('Não foi possível confirmar o e-mail original.');
                    raw = fetched.source;
                  } finally {
                    lock.release();
                  }
                }
                await copyMessage(r, message, target, destination.id, targetMessageId, raw);
                copied = await r.db
                  .selectFrom('messages')
                  .selectAll()
                  .where('id', '=', targetMessageId)
                  .executeTakeFirstOrThrow();
              }
              targetThreads.add(copied.thread_id);
              if (target.receiving_protocol === 'imap' && !destination.is_local) {
                // Export only verified source attachments; destination has its own independent scan records.
                const imap = await targetImap(),
                  lock = await imap.getMailboxLock(destination.imap_path);
                let uid: number | undefined;
                try {
                  const matches = await imap.search(
                    { header: { 'X-APMail-Transfer-ID': targetMessageId } },
                    { uid: true },
                  );
                  uid = Array.isArray(matches) ? matches.at(-1) : undefined;
                  if (!uid) {
                    const reconstructed = await buffer(await backupMime(r.db, r.storage, message));
                    const raw =
                      remoteSource && copied.raw_storage_path
                        ? await buffer(await r.storage.openReadStream(copied.raw_storage_path))
                        : reconstructed;
                    const appended = await imap.append(
                      destination.imap_path,
                      Buffer.concat([
                        Buffer.from('X-APMail-Transfer-ID: ' + targetMessageId + '\r\n'),
                        raw,
                      ]),
                      message.is_flagged ? ['\\Seen', '\\Flagged'] : ['\\Seen'],
                      message.message_at,
                    );
                    uid = appended ? appended.uid : undefined;
                    if (!uid) {
                      const found = await imap.search(
                        { header: { 'X-APMail-Transfer-ID': targetMessageId } },
                        { uid: true },
                      );
                      uid = Array.isArray(found) ? found.at(-1) : undefined;
                    }
                  }
                  if (!uid) throw new Error('O servidor de destino ainda não confirmou a cópia.');
                } finally {
                  lock.release();
                }
                await r.db
                  .updateTable('messages')
                  .set({ imap_uid: uid, source_kind: 'imap' })
                  .where('id', '=', targetMessageId)
                  .execute();
              }
              // Only a committed, complete destination can authorize deleting the provider source.
              if (remoteSource) {
                const imap = await sourceImap(),
                  lock = await imap.getMailboxLock(sourceFolder.imap_path);
                try {
                  if (
                    sourceFolder.uidvalidity === null ||
                    !imap.mailbox ||
                    String(imap.mailbox.uidValidity) !== String(sourceFolder.uidvalidity)
                  )
                    throw new UnrecoverableError(
                      'A pasta de origem mudou no servidor. A cópia foi preservada.',
                    );
                  const present = await imap.fetchOne(
                    message.imap_uid!,
                    { envelope: true },
                    { uid: true },
                  );
                  if (present) {
                    if (present.envelope?.messageId !== message.message_id_header)
                      throw new UnrecoverableError('A mensagem de origem mudou no servidor.');
                    await imap.messageDelete([Number(message.imap_uid)], { uid: true });
                  }
                } finally {
                  lock.release();
                }
              }
              await r.db.transaction().execute(async (tx) => {
                await tx
                  .updateTable('messages')
                  .set({ deleted_at: new Date(), pending_action: false })
                  .where('id', '=', message.id)
                  .where('tenant_id', '=', action.tenant_id)
                  .execute();
                await tx
                  .updateTable('messages')
                  .set({ pending_action: false })
                  .where('id', '=', targetMessageId)
                  .execute();
                await touchThreads(
                  tx,
                  [message.thread_id, copied!.thread_id],
                  'manual',
                  action.requested_by,
                );
                await audit(tx, {
                  tenantId: action.tenant_id,
                  actorId: action.requested_by,
                  action: 'message.transferred',
                  entityType: 'message',
                  entityId: message.id,
                  metadata: {
                    operation_id: action.id,
                    target_message_id: targetMessageId,
                    target_mailbox_id: target.id,
                    target_folder_id: destination.id,
                  },
                  eventKey: action.id + ':' + message.id + ':transferred',
                });
              });
            }
            await r.db
              .updateTable('mail_actions')
              .set({ status: 'done', processed_at: new Date(), last_error: null })
              .where('id', '=', action.id)
              .execute();
          } catch (error) {
            if (lastAttempt || error instanceof UnrecoverableError) {
              const text =
                'Não foi possível concluir a movimentação entre caixas. E-mails ainda não movidos foram preservados na origem.';
              await r.db.transaction().execute(async (tx) => {
                await tx
                  .updateTable('messages')
                  .set({ pending_action: false })
                  .where('id', 'in', p.message_ids)
                  .where('tenant_id', '=', action.tenant_id)
                  .where('mailbox_id', '=', action.mailbox_id)
                  .execute();
                await tx
                  .updateTable('messages')
                  .set({ pending_action: false })
                  .where('id', 'in', Object.values(p.target_message_ids))
                  .where('tenant_id', '=', action.tenant_id)
                  .where('mailbox_id', '=', p.target_mailbox_id)
                  .execute();
                await tx
                  .updateTable('mail_actions')
                  .set({ status: 'failed', last_error: text, processed_at: new Date() })
                  .where('id', '=', action.id)
                  .execute();
                if (action.requested_by) {
                  const notification = await tx
                    .insertInto('notifications')
                    .values({
                      tenant_id: action.tenant_id,
                      user_id: action.requested_by,
                      type: 'action_failed',
                      title: 'Movimentação de e-mail não concluída',
                      body: text,
                      link: '/mail/' + action.mailbox_id,
                      payload: asJson({ action_id: action.id }),
                    })
                    .returningAll()
                    .executeTakeFirstOrThrow();
                  r.io.to('user:' + action.requested_by).emit('notification:new', { notification });
                }
              });
            }
            throw error;
          } finally {
            await sourceTransport?.close();
            await targetTransport?.close();
            emitThreads(r, initial.mailbox_id, [...sourceThreads]);
            emitThreads(r, p.target_mailbox_id, [...targetThreads]);
          }
        },
        30000,
      );
      if (inner === 'skipped')
        throw new Error('Caixa de destino ocupada. A movimentação será tentada novamente.');
    },
    30000,
  );
  if (result === 'skipped')
    throw new Error('Caixa de origem ocupada. A movimentação será tentada novamente.');
}

async function copyMessage(
  r: WorkerResources,
  source: Message,
  target: Mailbox,
  folderId: string,
  id: string,
  raw?: Buffer,
) {
  const written: string[] = [],
    scans: Awaited<ReturnType<typeof registerSecurityFile>>[] = [];
  try {
    await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, target.tenant_id);
      const threadId = await resolveThread(
        tx,
        {
          ...source,
          mailbox_id: target.id,
          to_addresses: source.to_addresses as unknown as Address[],
          cc_addresses: source.cc_addresses as unknown as Address[],
        },
        [target.email_address, ...target.aliases],
      );
      const existingThreadMessage = await tx
        .selectFrom('messages')
        .select('id')
        .where('thread_id', '=', threadId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      const {
        id: unusedId,
        mailbox_id: unusedBox,
        thread_id: unusedThread,
        folder_id: unusedFolder,
        search_vector: unusedSearch,
        created_at: unusedCreated,
        updated_at: unusedUpdated,
        ...content
      } = source;
      void [
        unusedId,
        unusedBox,
        unusedThread,
        unusedFolder,
        unusedSearch,
        unusedCreated,
        unusedUpdated,
      ];
      const rawPath =
        raw || source.raw_storage_path
          ? `mail-raw/${target.tenant_id}/${target.id}/${id}.eml`
          : null;
      await tx
        .insertInto('messages')
        .values({
          ...content,
          to_addresses: asJson(source.to_addresses),
          cc_addresses: asJson(source.cc_addresses),
          bcc_addresses: asJson(source.bcc_addresses),
          reply_to_addresses: asJson(source.reply_to_addresses),
          id,
          mailbox_id: target.id,
          thread_id: threadId,
          folder_id: folderId,
          source_kind: 'archive',
          source_key: 'transfer:' + id,
          imap_uid: null,
          outbox_id: null,
          raw_storage_path: rawPath,
          archive_reconstructed_key: null,
          pending_action: true,
          deleted_at: null,
          rules_inbox: false,
          rules_applied_at: new Date(),
          auto_reply_to: null,
        })
        .execute();
      if (rawPath) {
        await r.storage
          .withDatabase(tx)
          .writeFile(rawPath, raw ?? (await r.storage.openReadStream(source.raw_storage_path!)));
        written.push(rawPath);
        scans.push(
          await registerSecurityFile(tx, {
            storage_key: rawPath,
            tenant_id: target.tenant_id,
            mailbox_id: target.id,
            message_id: id,
            resource_id: id,
            filename: 'message.eml',
            content_type: 'message/rfc822',
            size_bytes: raw?.length ?? source.size_bytes,
            kind: 'mail_raw',
          }),
        );
      }
      const attachments = await tx
        .selectFrom('attachments')
        .selectAll()
        .where('message_id', '=', source.id)
        .where('tenant_id', '=', target.tenant_id)
        .execute();
      for (const a of attachments) {
        const attachmentId = randomUUID(),
          path = `attachments/${target.tenant_id}/${target.id}/${id}/${attachmentId}`;
        await r.storage
          .withDatabase(tx)
          .writeFile(path, await r.storage.openReadStream(a.storage_path));
        written.push(path);
        await tx
          .insertInto('attachments')
          .values({
            ...a,
            id: attachmentId,
            mailbox_id: target.id,
            message_id: id,
            storage_path: path,
          })
          .execute();
        scans.push(
          await registerSecurityFile(tx, {
            storage_key: path,
            tenant_id: target.tenant_id,
            mailbox_id: target.id,
            message_id: id,
            resource_id: attachmentId,
            filename: a.filename,
            content_type: a.content_type,
            size_bytes: a.size_bytes,
            kind: 'attachment',
          }),
        );
      }
      const state = await tx
        .selectFrom('thread_user_state')
        .select(['user_id', 'last_read_at'])
        .where('thread_id', '=', source.thread_id)
        .where('tenant_id', '=', target.tenant_id)
        .execute();
      for (const s of state)
        if (
          !existingThreadMessage &&
          s.last_read_at &&
          (await userCanReadFolder(tx, target.tenant_id, target.id, s.user_id, folderId))
        )
          await sql`insert into thread_user_state(thread_id,user_id,tenant_id,last_read_at) values(${threadId}::uuid,${s.user_id}::uuid,${target.tenant_id}::uuid,${s.last_read_at}::timestamptz) on conflict(thread_id,user_id) do nothing`.execute(
            tx,
          );
      await touchThreads(tx, [threadId], 'sync', null);
      await assertStorageCapacity(tx, target.tenant_id, target.id);
    });
  } catch (error) {
    for (const path of written) await r.storage.removeFile(path).catch(() => {});
    throw error;
  }
  for (const scan of scans)
    await enqueueSecurityScan(r.queues['antivirus-scan'], scan).catch(() => {});
}
