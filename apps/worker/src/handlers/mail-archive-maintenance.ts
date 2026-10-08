import type { WorkerResources } from '../resources.js';
import { sql } from 'kysely';
export async function cleanupMailArchiveFiles(r: WorkerResources) {
  const pending = await r.db
    .selectFrom('storage_assets')
    .select('storage_key')
    .where('category', '=', 'mail_purge_pending')
    .where('state', '=', 'present')
    .where(
      sql<boolean>`not exists(select 1 from storage_asset_refs r where r.asset_id=storage_assets.id)`,
    )
    .limit(1000)
    .execute();
  for (const file of pending)
    await r.storage
      .removeFile(file.storage_key)
      .catch(() => r.log.warn('Limpeza de backup pendente; bytes continuam contabilizados.'));
  const abandoned = await r.db
    .selectFrom('mail_archive_imports')
    .select(['id', 'storage_path'])
    .where((eb) =>
      eb.or([
        eb.and([eb('state', '=', 'cancelled'), eb('storage_path', 'is not', null)]),
        eb.and([
          eb('state', '=', 'uploading'),
          eb('created_at', '<', new Date(Date.now() - 36 * 3600000)),
        ]),
      ]),
    )
    .limit(1000)
    .execute();
  for (const task of abandoned) {
    try {
      if (task.storage_path) await r.storage.removeFile(task.storage_path);
    } catch {
      r.log.warn(
        { import_id: task.id },
        'Arquivo cancelado aguarda nova tentativa de limpeza; bytes continuam contabilizados.',
      );
      continue;
    }
    await r.db
      .updateTable('mail_archive_imports')
      .set({ state: 'cancelled', storage_path: null, updated_at: new Date() })
      .where('id', '=', task.id)
      .where('state', 'in', ['cancelled', 'uploading'])
      .execute();
  }
}
