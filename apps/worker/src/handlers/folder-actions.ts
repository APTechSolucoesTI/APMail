import { z } from 'zod';
import { UnrecoverableError } from 'bullmq';
import { asJson } from '@apmail/db';
import type { Selectable } from 'kysely';
import type { DB } from '@apmail/db';
import type { WorkerResources } from '../resources.js';
import { transports } from '../imap/connect.js';
import { syncFolders } from '../imap/sync-folders.js';
import { withMailboxLock } from '../lib/mailbox-lock.js';
import { isConnectionError } from '../lib/errors.js';
import { markMailboxError } from './mailbox-connection.js';
import { userCanMailbox } from '../lib/mailbox-permissions.js';
import { planFolderRelocation } from '@apmail/shared/folder-relocation';
import { isTenantAdmin } from '@apmail/shared';
import { sql } from 'kysely';
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
      let t: Awaited<ReturnType<typeof transports>> | undefined;
      try {
        const p = z
          .object({
            folder_id: z.uuid().optional(),
            imap_path: z.string().optional(),
            source_path: z.string().optional(),
            name: z.string().optional(),
            parent_id: z.uuid().nullable().optional(),
          })
          .parse(action.payload);
        if (box.status !== 'active') throw new UnrecoverableError('Caixa indisponível.');
        if (
          action.requested_by &&
          (await r.db
            .selectFrom('platform_admins')
            .select('user_id')
            .where('user_id', '=', action.requested_by)
            .executeTakeFirst())
        )
          throw new UnrecoverableError('O superadmin não pode alterar pastas.');
        if (
          !action.requested_by ||
          !(await userCanMailbox(r, box, action.requested_by, 'organize')) ||
          !(await userCanMailbox(r, box, action.requested_by, 'read'))
        )
          throw new UnrecoverableError('Você não tem mais permissão para organizar esta caixa.');
        await r.db
          .updateTable('mail_actions')
          .set({ status: 'processing', attempts: action.attempts + 1 })
          .where('id', '=', action.id)
          .execute();
        const folders = await r.db
          .selectFrom('folders')
          .selectAll()
          .where('tenant_id', '=', box.tenant_id)
          .where('mailbox_id', '=', box.id)
          .where('deleted_at', 'is', null)
          .execute();
        const referenceFolder = p.folder_id ?? p.parent_id;
        const localFolder = folders.find((f) => f.id === referenceFolder);
        if (referenceFolder && !localFolder) throw new UnrecoverableError('Pasta indisponível.');
        if (p.folder_id && localFolder?.special_use)
          throw new UnrecoverableError('Pastas especiais não podem ser alteradas.');
        let changes: ReturnType<typeof planFolderRelocation> = [];
        if (action.type === 'rename_folder') {
          if (!localFolder || !p.name || !p.imap_path)
            throw new UnrecoverableError('Destino inválido.');
          if (
            p.source_path &&
            localFolder.imap_path !== p.source_path &&
            localFolder.imap_path !== p.imap_path
          )
            throw new UnrecoverableError('A pasta foi alterada por outra operação.');
          try {
            changes = planFolderRelocation(folders, localFolder.id, {
              name: p.name,
              parent_id: p.parent_id === undefined ? localFolder.parent_id : p.parent_id,
            });
          } catch (error) {
            throw new UnrecoverableError(
              error instanceof Error ? error.message : 'Destino inválido.',
            );
          }
          if (changes.find((f) => f.id === localFolder.id)?.imap_path !== p.imap_path)
            throw new UnrecoverableError('A pasta de destino foi alterada. Atualize a lista.');
        }
        // Permissions may change while a job waits; resolve inherited folder access again.
        const access = await r.db
          .selectFrom('tenant_members as tm')
          .leftJoin('mailbox_members as mm', (j) =>
            j
              .onRef('mm.tenant_id', '=', 'tm.tenant_id')
              .onRef('mm.user_id', '=', 'tm.user_id')
              .on('mm.mailbox_id', '=', box.id),
          )
          .select(['tm.role', 'mm.role as mailbox_role', 'mm.restrict_to_folders'])
          .where('tm.tenant_id', '=', box.tenant_id)
          .where('tm.user_id', '=', action.requested_by)
          .executeTakeFirstOrThrow();
        if (
          !isTenantAdmin(access.role) &&
          access.mailbox_role !== 'mailbox_admin' &&
          access.restrict_to_folders
        ) {
          const allowed = await sql<{ id: string }>`with recursive allowed as (
            select f.id from folders f join folder_permissions p on p.folder_id=f.id and p.tenant_id=f.tenant_id and p.mailbox_id=f.mailbox_id
            where p.tenant_id=${box.tenant_id} and p.mailbox_id=${box.id} and p.user_id=${action.requested_by} and f.deleted_at is null
            union select f.id from folders f join allowed a on f.parent_id=a.id
            where f.tenant_id=${box.tenant_id} and f.mailbox_id=${box.id} and f.deleted_at is null
          ) select id from allowed`.execute(r.db);
          const visible = new Set(allowed.rows.map((f) => f.id));
          const required = [p.folder_id, p.parent_id, ...changes.map((f) => f.id)].filter(
            (id): id is string => !!id,
          );
          if (required.some((id) => !visible.has(id)))
            throw new UnrecoverableError('Você não tem mais acesso às pastas desta operação.');
        }
        if (box.receiving_protocol !== 'imap' || localFolder?.is_local) {
          await r.db.transaction().execute(async (tx) => {
            if (action.type === 'create_folder')
              await tx
                .insertInto('folders')
                .values({
                  tenant_id: box.tenant_id,
                  mailbox_id: box.id,
                  name: p.name!,
                  imap_path: p.imap_path!,
                  parent_id: p.parent_id ?? null,
                  is_local: true,
                })
                .onConflict((oc) =>
                  oc
                    .columns(['mailbox_id', 'imap_path'])
                    .where('deleted_at', 'is', null)
                    .doNothing(),
                )
                .execute();
            else if (action.type === 'delete_folder') {
              const occupied = await tx
                .selectFrom('messages')
                .select('id')
                .where('folder_id', '=', p.folder_id!)
                .where('tenant_id', '=', box.tenant_id)
                .where('deleted_at', 'is', null)
                .executeTakeFirst();
              const child = await tx
                .selectFrom('folders')
                .select('id')
                .where('parent_id', '=', p.folder_id!)
                .where('deleted_at', 'is', null)
                .executeTakeFirst();
              if (occupied || child) throw new Error('Esvazie a pasta antes de excluir.');
              await tx
                .updateTable('folders')
                .set({ deleted_at: new Date() })
                .where('id', '=', p.folder_id!)
                .where('tenant_id', '=', box.tenant_id)
                .where('special_use', 'is', null)
                .execute();
            } else {
              for (const { id, ...change } of changes)
                await tx
                  .updateTable('folders')
                  .set(change)
                  .where('id', '=', id)
                  .where('tenant_id', '=', box.tenant_id)
                  .where('mailbox_id', '=', box.id)
                  .execute();
            }
            await tx
              .updateTable('mail_actions')
              .set({ status: 'done', processed_at: new Date(), last_error: null })
              .where('id', '=', action.id)
              .execute();
          });
          r.io
            .to('mailbox:' + box.id)
            .emit('folders:changed', { mailbox_id: box.id, action_id: action.id, status: 'done' });
          return;
        }
        t = await transports(r.db, box, r.env);
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
              if (remote.some((f) => f.path === folder.imap_path)) {
                if (
                  remote.some(
                    (f) =>
                      f.path === p.imap_path ||
                      f.path.startsWith(p.imap_path! + (folder.delimiter ?? '/')),
                  )
                )
                  throw new UnrecoverableError('Já existe uma pasta no destino no servidor.');
                await t.imap.mailboxRename(folder.imap_path, p.imap_path);
              } else if (!remote.some((f) => f.path === p.imap_path))
                throw Error('Pasta não encontrada.');
              await r.db.transaction().execute(async (tx) => {
                for (const { id, ...change } of changes)
                  await tx
                    .updateTable('folders')
                    .set(change)
                    .where('id', '=', id)
                    .where('tenant_id', '=', box.tenant_id)
                    .where('mailbox_id', '=', box.id)
                    .execute();
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
        if (lastAttempt || error instanceof UnrecoverableError) {
          const text =
            error instanceof UnrecoverableError
              ? error.message
              : 'Não foi possível alterar a pasta. Confira se ela e o destino ainda existem; para excluir, a pasta deve estar vazia.';
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
            r.io.to('user:' + action.requested_by).emit('folders:changed', {
              mailbox_id: box.id,
              action_id: action.id,
              status: 'failed',
              error: text,
            });
        }
        throw error;
      } finally {
        await t?.close();
      }
    },
    30000,
  );
  if (result === 'skipped') throw Error('Caixa ocupada. A operação será tentada novamente.');
}
