import { lockStorageTenant, purgeRetainedMessage } from '@apmail/db';
import { sql } from 'kysely';
import type { WorkerResources } from '../resources.js';

export async function purgeRetainedMail(r: WorkerResources) {
  const now = new Date();
  const rows = await r.db
    .selectFrom('messages')
    .select(['id', 'tenant_id'])
    .where('retention_expires_at', 'is not', null)
    .where('pending_action', '=', false)
    .where((eb) =>
      eb.or([
        eb('retention_purge_requested_at', 'is not', null),
        eb('retention_expires_at', '<=', now),
      ]),
    )
    .where((eb) =>
      eb.or([eb('retention_retry_at', 'is', null), eb('retention_retry_at', '<=', now)]),
    )
    .orderBy(sql`coalesce(retention_purge_requested_at, retention_expires_at)`)
    .orderBy('id')
    .limit(500)
    .execute();
  for (const row of rows) {
    try {
      await purgeRetainedMessage(r.db, row.tenant_id, row.id, now);
    } catch (error) {
      r.log.error(
        { err: error, message_id: row.id, tenant_id: row.tenant_id },
        'Falha na limpeza de retenção.',
      );
      await r.db
        .updateTable('messages')
        .set({
          retention_retry_at: new Date(now.getTime() + 15 * 60_000),
          retention_last_error: 'Não foi possível concluir a limpeza. O sistema tentará novamente.',
        })
        .where('id', '=', row.id)
        .where('tenant_id', '=', row.tenant_id)
        .where('retention_expires_at', 'is not', null)
        .execute();
    }
  }

  // Database changes commit before file removal. Failed unlinks remain metered and retryable.
  const files = await r.db
    .selectFrom('storage_assets')
    .select(['id', 'tenant_id', 'storage_key'])
    .where('category', '=', 'retention_purge_pending')
    .where('state', 'in', ['pending', 'present', 'unreadable'])
    .where(
      sql<boolean>`not exists(select 1 from storage_asset_refs ref where ref.asset_id=storage_assets.id)`,
    )
    .orderBy('updated_at')
    .limit(1000)
    .execute();
  for (const file of files) {
    if (!file.tenant_id) continue;
    const tenantId = file.tenant_id;
    try {
      await r.db.transaction().execute(async (tx) => {
        await lockStorageTenant(tx, tenantId);
        const current = await tx
          .selectFrom('storage_assets')
          .select('storage_key')
          .where('id', '=', file.id)
          .where('tenant_id', '=', tenantId)
          .where('category', '=', 'retention_purge_pending')
          .where('state', 'in', ['pending', 'present', 'unreadable'])
          .where(
            sql<boolean>`not exists(select 1 from storage_asset_refs ref where ref.asset_id=storage_assets.id)`,
          )
          .executeTakeFirst();
        if (current) await r.storage.withDatabase(tx).removeFile(current.storage_key);
      });
    } catch (error) {
      r.log.warn(
        { err: error, asset_id: file.id },
        'Arquivo em retenção aguarda nova tentativa de limpeza.',
      );
      await r.db
        .updateTable('storage_assets')
        .set({ updated_at: new Date() })
        .where('id', '=', file.id)
        .where('tenant_id', '=', tenantId)
        .execute();
    }
  }
}
