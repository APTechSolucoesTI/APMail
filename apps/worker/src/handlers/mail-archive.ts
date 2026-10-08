import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ensureLocalFolders, isStorageQuotaError, audit } from '@apmail/db';
import { MAIL_MESSAGE_MAX_BYTES } from '@apmail/shared';
import { withMailboxLock } from '../lib/mailbox-lock.js';
import { ingestMessage } from '../imap/ingest-message.js';
import { emitThreads } from '../lib/events.js';
import { readMailArchive } from '../archives/read-mail-archive.js';
import type { WorkerResources } from '../resources.js';
export async function handleMailArchive(r: WorkerResources, importId: string, jobId: string) {
  const task = await r.db
    .selectFrom('mail_archive_imports')
    .selectAll()
    .where('id', '=', importId)
    .executeTakeFirst();
  if (!task || !task.storage_path || !['queued', 'running'].includes(task.state)) return;
  const result = await withMailboxLock(
    r.redis,
    task.mailbox_id,
    jobId,
    async () => {
      const box = await r.db
        .selectFrom('mailboxes')
        .selectAll()
        .where('id', '=', task.mailbox_id)
        .where('tenant_id', '=', task.tenant_id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      const tenant = await r.db
        .selectFrom('tenants')
        .select('id')
        .where('id', '=', task.tenant_id)
        .where('deleted_at', 'is', null)
        .where('suspended_at', 'is', null)
        .executeTakeFirst();
      if (!box || !tenant) return;
      const active = await r.db
        .updateTable('mail_archive_imports')
        .set({ state: 'running', last_error: null, updated_at: new Date() })
        .where('id', '=', task.id)
        .where('state', 'in', ['queued', 'running'])
        .returning('cursor')
        .executeTakeFirst();
      if (!active) return;
      const affected = new Set<string>();
      let index = 0;
      try {
        if (!box.import_started_at) {
          box.import_started_at = new Date();
          await r.db
            .updateTable('mailboxes')
            .set({ import_started_at: box.import_started_at })
            .where('id', '=', box.id)
            .execute();
        }
        if (box.receiving_protocol !== 'imap')
          await ensureLocalFolders(r.db, box.tenant_id, box.id);
        const folders = new Map<string, Awaited<ReturnType<typeof ensureLocalFolders>>>();
        for await (const item of readMailArchive(
          resolve(r.env.STORAGE_DIR, task.storage_path!),
          task.format,
          task.filename,
        )) {
          index++;
          if (index <= active.cursor) continue;
          if (
            (
              await r.db
                .selectFrom('mail_archive_imports')
                .select('state')
                .where('id', '=', task.id)
                .executeTakeFirst()
            )?.state !== 'running'
          )
            return;
          if (item.raw.length > MAIL_MESSAGE_MAX_BYTES)
            throw new Error('Mensagem acima de 50 MiB.');
          const path =
            'local/importados/' +
            item.folder
              .split(/[\\/]+/)
              .filter((p) => p && p !== '.' && p !== '..')
              .map((p) => p.slice(0, 100))
              .slice(0, 100)
              .join('/')
              .slice(0, 900);
          let folder = folders.get(path);
          if (!folder) {
            let parentId: string | null = null;
            const parts = path.split('/');
            for (let depth = 2; depth <= parts.length; depth++) {
              const childPath = parts.slice(0, depth).join('/');
              let child =
                folders.get(childPath) ??
                (await r.db
                  .selectFrom('folders')
                  .selectAll()
                  .where('tenant_id', '=', box.tenant_id)
                  .where('mailbox_id', '=', box.id)
                  .where('imap_path', '=', childPath)
                  .where('deleted_at', 'is', null)
                  .executeTakeFirst());
              if (!child) {
                await r.db
                  .insertInto('folders')
                  .values({
                    tenant_id: box.tenant_id,
                    mailbox_id: box.id,
                    name: depth === 2 ? 'Importados' : parts[depth - 1]!,
                    imap_path: childPath,
                    parent_id: parentId,
                    is_local: true,
                    special_use: null,
                  })
                  .onConflict((oc) =>
                    oc
                      .columns(['mailbox_id', 'imap_path'])
                      .where('deleted_at', 'is', null)
                      .doNothing(),
                  )
                  .execute();
                child = await r.db
                  .selectFrom('folders')
                  .selectAll()
                  .where('tenant_id', '=', box.tenant_id)
                  .where('mailbox_id', '=', box.id)
                  .where('imap_path', '=', childPath)
                  .where('deleted_at', 'is', null)
                  .executeTakeFirstOrThrow();
              }
              if (child.parent_id !== parentId) {
                await r.db
                  .updateTable('folders')
                  .set({ parent_id: parentId })
                  .where('id', '=', child.id)
                  .where('tenant_id', '=', box.tenant_id)
                  .execute();
                child.parent_id = parentId;
              }
              folders.set(childPath, child);
              parentId = child.id;
              folder = child;
            }
          }
          if (!folder) throw new Error('Pasta de importação indisponível.');
          const key = createHash('sha256').update(item.raw).digest('hex');
          const thread = await ingestMessage(
            r,
            box,
            folder,
            { seq: index, uid: index, source: item.raw, size: item.raw.length, flags: new Set() },
            {
              kind: 'archive',
              key,
              historical: true,
              persisted: async (tx, imported) => {
                const { sql } = await import('kysely');
                const saved = await tx
                  .updateTable('mail_archive_imports')
                  .set({
                    cursor: index,
                    imported: sql`imported+${imported ? 1 : 0}`,
                    skipped: sql`skipped+${imported ? 0 : 1}`,
                    updated_at: new Date(),
                  })
                  .where('id', '=', task.id)
                  .where('state', '=', 'running')
                  .returning('id')
                  .executeTakeFirst();
                if (!saved) throw new Error('Importação interrompida.');
              },
            },
          );
          affected.add(thread);
          if (index % 25 === 0) {
            emitThreads(r, box.id, [...affected]);
            affected.clear();
            r.io
              .to('mailbox:' + box.id)
              .emit('mail:archive-progress', { mailbox_id: box.id, import_id: task.id });
          }
        }
        if (index === 0)
          throw new Error('O arquivo não contém mensagens de e-mail em formato suportado.');
        await r.storage.removeFile(task.storage_path!);
        await r.db
          .updateTable('mail_archive_imports')
          .set({ state: 'completed', storage_path: null, updated_at: new Date() })
          .where('id', '=', task.id)
          .where('state', '=', 'running')
          .execute();
        await audit(r.db, {
          tenantId: box.tenant_id,
          actorId: task.created_by,
          action: 'mail.archive_completed',
          entityType: 'mailbox',
          entityId: box.id,
          metadata: { import_id: task.id, processed: index, format: task.format },
        }).catch(() => undefined);
      } catch (error) {
        const state = isStorageQuotaError(error) ? 'paused' : 'failed';
        const text = isStorageQuotaError(error)
          ? 'Importação pausada pela cota. Amplie ou redistribua o armazenamento e clique em Retomar. O checkpoint foi preservado.'
          : error instanceof Error && !/password|secret|token/i.test(error.message)
            ? error.message.slice(0, 300)
            : 'Não foi possível processar o arquivo de e-mail.';
        await r.db
          .updateTable('mail_archive_imports')
          .set({ state, last_error: text, updated_at: new Date() })
          .where('id', '=', task.id)
          .where('state', '=', 'running')
          .execute();
        r.log.warn(
          { import_id: task.id, state },
          'Importação de arquivo interrompida; checkpoint preservado.',
        );
      } finally {
        emitThreads(r, box.id, [...affected]);
        r.io.to('mailbox:' + box.id).emit('folders:changed', { mailbox_id: box.id });
        r.io
          .to('mailbox:' + box.id)
          .emit('mail:archive-progress', { mailbox_id: box.id, import_id: task.id });
      }
    },
    30000,
  );
  if (result === 'skipped') throw new Error('Caixa ocupada. A importação será retomada.');
}
