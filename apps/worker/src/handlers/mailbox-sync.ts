import { touchThreads } from '@apmail/db';
import type { WorkerResources } from '../resources.js';
import { transports } from '../imap/connect.js';
import { syncFolders } from '../imap/sync-folders.js';
import { ingestMessage } from '../imap/ingest-message.js';
import { withMailboxLock } from '../lib/mailbox-lock.js';
import { isConnectionError } from '../lib/errors.js';
import { markMailboxError } from './mailbox-connection.js';
import { emitThreads } from '../lib/events.js';
import { applyPendingRules } from './rules-apply.js';
export async function handleMailboxSync(r: WorkerResources, mailboxId: string, jobId: string) {
  return withMailboxLock(r.redis, mailboxId, jobId, async () => {
    const box = await r.db
      .selectFrom('mailboxes')
      .selectAll()
      .where('id', '=', mailboxId)
      .where('status', '=', 'active')
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!box) return;
    const t = await transports(r.db, box, r.env),
      affected = new Set<string>();
    const reconcile =
      !box.last_reconciled_at ||
      Date.now() - box.last_reconciled_at.getTime() > r.env.WORKER_RECONCILE_EVERY_MINUTES * 60000;
    try {
      await t.imap.connect();
      const folders = await syncFolders(r, box, t.imap);
      for (const folder of folders) {
        const lock = await t.imap.getMailboxLock(folder.imap_path);
        try {
          if (!t.imap.mailbox) continue;
          const validity = String(t.imap.mailbox.uidValidity);
          if (folder.uidvalidity !== validity) {
            const removed = await r.db
              .updateTable('messages')
              .set({ deleted_at: new Date() })
              .where('folder_id', '=', folder.id)
              .where('deleted_at', 'is', null)
              .returning('thread_id')
              .execute();
            removed.forEach((m) => affected.add(m.thread_id));
            folder.last_uid = '0';
            folder.uidvalidity = validity;
            await r.db
              .updateTable('folders')
              .set({ last_uid: 0, uidvalidity: validity })
              .where('id', '=', folder.id)
              .execute();
          }
          const cursor = Number(folder.last_uid);
          const results = await t.imap.search(
            cursor ? { uid: `${cursor + 1}:*` } : { since: box.sync_since },
            { uid: true },
          );
          const uids = (Array.isArray(results) ? results : [])
            .filter((uid) => uid > cursor)
            .sort((a, b) => a - b);
          let consecutive = true,
            lastUid = cursor;
          for (let offset = 0; offset < uids.length; offset += 25) {
            const batch = uids.slice(offset, offset + 25);
            // Busca tamanho antes do corpo para nunca carregar MIME acima de 50 MB.
            const metadata = await t.imap.fetchAll(
              batch,
              {
                uid: true,
                flags: true,
                internalDate: true,
                size: true,
                envelope: true,
                bodyStructure: true,
              },
              { uid: true },
            );
            for (const meta of metadata.sort((a, b) => a.uid - b.uid)) {
              try {
                const msg =
                  (meta.size ?? 0) > 50 * 1024 * 1024
                    ? meta
                    : await t.imap.fetchOne(
                        meta.uid,
                        { uid: true, flags: true, internalDate: true, size: true, source: true },
                        { uid: true },
                      );
                if (!msg) throw new Error('Mensagem não encontrada durante a importação.');
                const threadId = await ingestMessage(r, box, folder, msg);
                affected.add(threadId);
                if (consecutive) lastUid = meta.uid;
              } catch {
                consecutive = false;
                r.log.warn(
                  { mailbox_id: box.id, folder_id: folder.id, uid: meta.uid },
                  'Mensagem não importada; o cursor preserva a tentativa.',
                );
              }
            }
            await r.db
              .updateTable('folders')
              .set({ last_uid: lastUid })
              .where('id', '=', folder.id)
              .execute();
          }
          if (reconcile) {
            const remote = await t.imap.search({ all: true }, { uid: true }),
              present = new Set(Array.isArray(remote) ? remote : []);
            const local = await r.db
              .selectFrom('messages')
              .select(['id', 'imap_uid', 'thread_id'])
              .where('folder_id', '=', folder.id)
              .where('deleted_at', 'is', null)
              .where('pending_action', '=', false)
              .where('imap_uid', '<=', String(lastUid))
              .execute();
            const missing = local.filter((m) => m.imap_uid && !present.has(Number(m.imap_uid)));
            if (missing.length) {
              await r.db
                .updateTable('messages')
                .set({ deleted_at: new Date() })
                .where(
                  'id',
                  'in',
                  missing.map((m) => m.id),
                )
                .execute();
              missing.forEach((m) => affected.add(m.thread_id));
            }
            const recent = await t.imap.search(
              { since: new Date(Date.now() - 30 * 86400000) },
              { uid: true },
            );
            const recentUids = Array.isArray(recent) ? recent : [];
            for (let offset = 0; offset < recentUids.length; offset += 200)
              for await (const m of t.imap.fetch(
                recentUids.slice(offset, offset + 200),
                { uid: true, flags: true },
                { uid: true },
              )) {
                const changed = await r.db
                  .updateTable('messages')
                  .set({ is_flagged: m.flags?.has('\\Flagged') ?? false })
                  .where('folder_id', '=', folder.id)
                  .where('imap_uid', '=', String(m.uid))
                  .where('pending_action', '=', false)
                  .where('is_flagged', '!=', m.flags?.has('\\Flagged') ?? false)
                  .returning('thread_id')
                  .execute();
                changed.forEach((m) => affected.add(m.thread_id));
              }
          }
        } finally {
          lock.release();
        }
      }
      await applyPendingRules(r, box, t.imap);
      if (affected.size)
        await r.db.transaction().execute((trx) => touchThreads(trx, [...affected], 'sync', null));
      await r.db
        .updateTable('mailboxes')
        .set({
          last_synced_at: new Date(),
          ...(reconcile ? { last_reconciled_at: new Date() } : {}),
        })
        .where('id', '=', box.id)
        .execute();
      emitThreads(r, box.id, [...affected]);
    } catch (error) {
      if (isConnectionError(error)) await markMailboxError(r, box, error);
      else throw error;
    } finally {
      await t.close();
    }
  });
}
