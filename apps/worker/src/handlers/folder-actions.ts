import { z } from 'zod';
import { asJson } from '@apmail/db';
import type { Selectable } from 'kysely';
import type { DB } from '@apmail/db';
import type { WorkerResources } from '../resources.js';
import { transports } from '../imap/connect.js';
import { syncFolders } from '../imap/sync-folders.js';
import { withMailboxLock } from '../lib/mailbox-lock.js';
import { isConnectionError } from '../lib/errors.js';
import { markMailboxError } from './mailbox-connection.js';
export async function handleFolderAction(
  r: WorkerResources,
  initial: Selectable<DB['mail_actions']>,
  jobId: string,
  lastAttempt: boolean,
) {
  const result = await withMailboxLock(
    r.redis,
    initial.mailbox_id,
    jobId,
    async () => {
      const action = await r.db
        .selectFrom('mail_actions')
        .selectAll()
        .where('id', '=', initial.id)
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
      const p = z
          .object({
            folder_id: z.uuid().optional(),
            imap_path: z.string().optional(),
            name: z.string().optional(),
            parent_id: z.uuid().nullable().optional(),
          })
          .parse(action.payload),
        t = await transports(r.db, box, r.env);
      try {
        if (box.status !== 'active') throw Error('Caixa indisponível.');
        await r.db
          .updateTable('mail_actions')
          .set({ status: 'processing', attempts: action.attempts + 1 })
          .where('id', '=', action.id)
          .execute();
        await t.imap.connect();
        const remote = await t.imap.list();
        if (action.type === 'create_folder') {
          if (!p.imap_path) throw Error('Destino inválido.');
          if (!remote.some((f) => f.path === p.imap_path)) await t.imap.mailboxCreate(p.imap_path);
        } else {
          const folder = await r.db
            .selectFrom('folders')
            .selectAll()
            .where('id', '=', p.folder_id!)
            .where('tenant_id', '=', box.tenant_id)
            .where('mailbox_id', '=', box.id)
            .executeTakeFirstOrThrow();
          if (folder.special_use) throw Error('Pastas especiais não podem ser alteradas.');
          if (action.type === 'delete_folder') {
            const children = remote.filter((f) =>
              f.path.startsWith(folder.imap_path + (folder.delimiter ?? '/')),
            );
            if (children.length) throw Error('A pasta possui subpastas.');
            if (remote.some((f) => f.path === folder.imap_path)) {
              const status = await t.imap.status(folder.imap_path, { messages: true });
              if (!status || status.messages === undefined)
                throw Error('Não foi possível conferir se a pasta está vazia.');
              if (status.messages) throw Error('A pasta não está vazia.');
              await t.imap.mailboxDelete(folder.imap_path);
            }
            await r.db
              .updateTable('folders')
              .set({ deleted_at: new Date() })
              .where('id', '=', folder.id)
              .where('tenant_id', '=', box.tenant_id)
              .execute();
          } else {
            if (!p.imap_path || !p.name) throw Error('Destino inválido.');
            if (folder.imap_path !== p.imap_path) {
              if (remote.some((f) => f.path === folder.imap_path))
                await t.imap.mailboxRename(folder.imap_path, p.imap_path);
              else if (!remote.some((f) => f.path === p.imap_path))
                throw Error('Pasta não encontrada.');
              const children = await r.db
                .selectFrom('folders')
                .selectAll()
                .where('tenant_id', '=', box.tenant_id)
                .where('mailbox_id', '=', box.id)
                .where('deleted_at', 'is', null)
                .execute();
              await r.db.transaction().execute(async (tx) => {
                for (const f of children) {
                  if (
                    f.id === folder.id ||
                    f.imap_path.startsWith(folder.imap_path + (folder.delimiter ?? '/'))
                  )
                    await tx
                      .updateTable('folders')
                      .set({
                        imap_path: p.imap_path! + f.imap_path.slice(folder.imap_path.length),
                        ...(f.id === folder.id ? { name: p.name! } : {}),
                      })
                      .where('id', '=', f.id)
                      .where('tenant_id', '=', box.tenant_id)
                      .execute();
                }
              });
            }
          }
        }
        await syncFolders(r, box, t.imap);
        await r.db
          .updateTable('mail_actions')
          .set({ status: 'done', processed_at: new Date(), last_error: null })
          .where('id', '=', action.id)
          .execute();
        r.io
          .to('mailbox:' + box.id)
          .emit('folders:changed', { mailbox_id: box.id, action_id: action.id, status: 'done' });
      } catch (error) {
        if (isConnectionError(error)) await markMailboxError(r, box, error);
        if (lastAttempt) {
          const text =
            'Não foi possível alterar a pasta. Confira se ela ainda existe e, para excluir, se está vazia.';
          await r.db.transaction().execute(async (tx) => {
            await tx
              .updateTable('mail_actions')
              .set({ status: 'failed', processed_at: new Date(), last_error: text })
              .where('id', '=', action.id)
              .execute();
            if (action.requested_by) {
              const notification = await tx
                .insertInto('notifications')
                .values({
                  tenant_id: box.tenant_id,
                  user_id: action.requested_by,
                  type: 'action_failed',
                  title: 'Não foi possível alterar pastas na caixa ' + box.name,
                  body: text,
                  link: '/mail/' + box.id,
                  payload: asJson({ action_id: action.id }),
                })
                .returningAll()
                .executeTakeFirstOrThrow();
              r.io.to('user:' + action.requested_by).emit('notification:new', { notification });
            }
          });
          if (action.requested_by)
            r.io
              .to('user:' + action.requested_by)
              .emit('folders:changed', {
                mailbox_id: box.id,
                action_id: action.id,
                status: 'failed',
                error: text,
              });
        }
        throw error;
      } finally {
        await t.close();
      }
    },
    30000,
  );
  if (result === 'skipped') throw Error('Caixa ocupada. A operação será tentada novamente.');
}
