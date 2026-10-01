import { z } from 'zod';
import { touchThreads, asJson } from '@apmail/db';
import type { WorkerResources } from '../resources.js';
import { transports } from '../imap/connect.js';
import { withMailboxLock } from '../lib/mailbox-lock.js';
import { emitThreads } from '../lib/events.js';
import { markMailboxError } from './mailbox-connection.js';
import { isConnectionError } from '../lib/errors.js';
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
      const t = await transports(r.db, box, r.env);
      const threadIds = new Set<string>();
      try {
        if (box.status !== 'active')
          throw new Error('Caixa indisponível. Reconecte antes de organizar mensagens.');
        await r.db
          .updateTable('mail_actions')
          .set({ status: 'processing', attempts: action.attempts + 1 })
          .where('id', '=', action.id)
          .execute();
        await t.imap.connect();
        const messages = await r.db
          .selectFrom('messages')
          .selectAll()
          .where('id', 'in', payload.message_ids)
          .where('tenant_id', '=', box.tenant_id)
          .where('mailbox_id', '=', box.id)
          .where('pending_action', '=', true)
          .execute();
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
          if (!source || !sourceUid)
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
            const present = await t.imap.search({ uid: String(sourceUid) }, { uid: true });
            const exists = Array.isArray(present) && present.includes(Number(sourceUid));
            if (action.type === 'set_flag') {
              if (!exists) throw new Error('Mensagem não encontrada no servidor.');
              if (payload.flagged)
                await t.imap.messageFlagsAdd([Number(sourceUid)], ['\\Flagged'], { uid: true });
              else
                await t.imap.messageFlagsRemove([Number(sourceUid)], ['\\Flagged'], { uid: true });
            } else if (action.type === 'delete' && source.special_use === 'trash') {
              if (exists) await t.imap.messageDelete([Number(sourceUid)], { uid: true });
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
              ...(deleted ? { deleted_at: new Date() } : {}),
            })
            .where('id', '=', m.id)
            .execute();
        }
        await r.db.transaction().execute(async (trx) => {
          await trx
            .updateTable('mail_actions')
            .set({ status: 'done', processed_at: new Date(), last_error: null })
            .where('id', '=', action.id)
            .execute();
          await touchThreads(trx, [...threadIds], 'mail_action', action.requested_by);
        });
        emitThreads(r, box.id, [...threadIds]);
      } catch (error) {
        if (isConnectionError(error)) await markMailboxError(r, box, error);
        if (lastAttempt) {
          const last_error =
            'Não foi possível aplicar a alteração no servidor de e-mail. A alteração foi revertida.';
          await r.db.transaction().execute(async (trx) => {
            const pending = await trx
              .selectFrom('messages')
              .select(['id', 'thread_id'])
              .where('id', 'in', payload.message_ids)
              .where('tenant_id', '=', box.tenant_id)
              .where('pending_action', '=', true)
              .execute();
            for (const m of pending) {
              threadIds.add(m.thread_id);
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
            await touchThreads(trx, [...threadIds], 'mail_action_failed', action.requested_by);
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
        await t.close();
      }
    },
    30000,
  );
  if (result === 'skipped') throw new Error('Caixa ocupada. A operação será tentada novamente.');
}
