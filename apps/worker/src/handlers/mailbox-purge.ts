import { sql } from 'kysely';
import { audit, lockStorageTenant } from '@apmail/db';
import type { WorkerResources } from '../resources.js';
import { withMailboxLock } from '../lib/mailbox-lock.js';

/** Only explicit, confirmed requests are eligible. Tombstones retain audit identity. */
export async function purgeMailboxes(r: WorkerResources) {
  const tasks = await r.db
    .selectFrom('mailbox_purge_requests')
    .selectAll()
    .where('state', '!=', 'completed')
    .orderBy('updated_at')
    .limit(10)
    .execute();
  for (const task of tasks) {
    try {
      await withMailboxLock(r.redis, task.mailbox_id, 'purge-' + task.mailbox_id, async () => {
        await r.db.transaction().execute(async (tx) => {
          await lockStorageTenant(tx, task.tenant_id);
          const box = await tx
            .selectFrom('mailboxes')
            .select('id')
            .where('id', '=', task.mailbox_id)
            .where('tenant_id', '=', task.tenant_id)
            .where('deleted_at', 'is not', null)
            .executeTakeFirst();
          if (!box) throw new Error('A caixa ainda está ativa.');
          const busy = await tx
            .selectFrom('outbox')
            .select('id')
            .where('mailbox_id', '=', box.id)
            .where('status', '=', 'sending')
            .executeTakeFirst();
          if (busy) throw new Error('Aguardando a conclusão de um envio.');
          const shared = (
            await sql<{
              used: boolean;
            }>`select exists(select 1 from outbox o where o.tenant_id=${task.tenant_id}::uuid and o.mailbox_id<>${box.id}::uuid and o.status in ('draft','queued','scheduled','sending','failed') and (exists(select 1 from attachments a where a.mailbox_id=${box.id}::uuid and o.attachments @> jsonb_build_array(jsonb_build_object('source','message_attachment','attachment_id',a.id::text))) or exists(select 1 from uploads u where u.mailbox_id=${box.id}::uuid and o.attachments @> jsonb_build_array(jsonb_build_object('source','upload','upload_id',u.id::text))))) as used`.execute(
              tx,
            )
          ).rows[0]!.used;
          if (shared) throw new Error('Anexos desta caixa ainda estão em uso em outra caixa.');
          await tx
            .updateTable('mailbox_purge_requests')
            .set({ state: 'running', last_error: null, updated_at: new Date() })
            .where('mailbox_id', '=', box.id)
            .execute();
          await tx
            .updateTable('messages')
            .set({ outbox_id: null })
            .where('mailbox_id', '=', box.id)
            .execute();
          await tx.deleteFrom('outbox').where('mailbox_id', '=', box.id).execute();
          await tx
            .updateTable('chat_messages')
            .set({ shared_thread_id: null })
            .where('tenant_id', '=', task.tenant_id)
            .where(
              'shared_thread_id',
              'in',
              tx.selectFrom('threads').select('id').where('mailbox_id', '=', box.id),
            )
            .execute();
          await tx.deleteFrom('messages').where('mailbox_id', '=', box.id).execute();
          await tx.deleteFrom('threads').where('mailbox_id', '=', box.id).execute();
          await tx.deleteFrom('mail_actions').where('mailbox_id', '=', box.id).execute();
          await tx.deleteFrom('mail_rules').where('mailbox_id', '=', box.id).execute();
          await tx.deleteFrom('folders').where('mailbox_id', '=', box.id).execute();
          await tx.deleteFrom('mail_archive_imports').where('mailbox_id', '=', box.id).execute();
          await tx.deleteFrom('uploads').where('mailbox_id', '=', box.id).execute();
          await tx
            .updateTable('outbox')
            .set({ signature_id: null })
            .where(
              'signature_id',
              'in',
              tx.selectFrom('signatures').select('id').where('mailbox_id', '=', box.id),
            )
            .execute();
          await tx.deleteFrom('signatures').where('mailbox_id', '=', box.id).execute();
          await tx
            .updateTable('invitations')
            .set({ sender_mailbox_id: null })
            .where('sender_mailbox_id', '=', box.id)
            .execute();
          await tx.deleteFrom('mailbox_members').where('mailbox_id', '=', box.id).execute();
          await tx.deleteFrom('label_mailboxes').where('mailbox_id', '=', box.id).execute();
          await sql`delete from mailbox_storage_limits where mailbox_id=${box.id}::uuid`.execute(
            tx,
          );
          await tx
            .updateTable('storage_assets')
            .set({ category: 'mail_purge_pending' })
            .where('tenant_id', '=', task.tenant_id)
            .where('mailbox_id', '=', box.id)
            .where(
              sql<boolean>`not exists(select 1 from storage_asset_refs ref where ref.asset_id=storage_assets.id)`,
            )
            .execute();
        });
        // Exact paths only. Failed unlinks stay charged and are retried by maintenance.
        const files = await r.db
          .selectFrom('storage_assets')
          .select('storage_key')
          .where('tenant_id', '=', task.tenant_id)
          .where('mailbox_id', '=', task.mailbox_id)
          .where('category', '=', 'mail_purge_pending')
          .where('state', 'in', ['pending', 'present', 'unreadable'])
          .execute();
        for (const file of files) await r.storage.removeFile(file.storage_key);
        await r.db.transaction().execute(async (tx) => {
          await lockStorageTenant(tx, task.tenant_id);
          await tx
            .updateTable('mailbox_purge_requests')
            .set({ state: 'completed', last_error: null, updated_at: new Date() })
            .where('mailbox_id', '=', task.mailbox_id)
            .execute();
          await audit(tx, {
            tenantId: task.tenant_id,
            actorId: task.requested_by,
            action: 'mailbox.purged',
            entityType: 'mailbox',
            entityId: task.mailbox_id,
          });
        });
        r.io.to('tenant:' + task.tenant_id).emit('mailboxes:changed', {});
      });
    } catch {
      await r.db
        .updateTable('mailbox_purge_requests')
        .set({
          state: 'failed',
          last_error:
            'A limpeza ainda não foi concluída. Os bytes permanecem contabilizados e o sistema tentará novamente.',
          updated_at: new Date(),
        })
        .where('mailbox_id', '=', task.mailbox_id)
        .execute();
      r.log.warn(
        { mailbox_id: task.mailbox_id },
        'Exclusão definitiva pendente de nova tentativa.',
      );
    }
  }
}
