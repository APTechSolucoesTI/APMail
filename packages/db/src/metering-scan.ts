import { opendir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from './types.js';
import { Storage } from './storage.js';
import { observeStorageFile } from './metering-files.js';
import { publishStorageUsage, type StorageRetention } from './metering-snapshot.js';

async function* walk(root: string, prefix = ''): AsyncGenerator<string> {
  const directory = await opendir(path.join(root, prefix));
  for await (const entry of directory) {
    const key = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Never follow a directory link. Files and links are checked by the protected Storage adapter.
    if (entry.isDirectory()) yield* walk(root, key);
    else yield key;
  }
}
async function* inventoryBatches(root: string): AsyncGenerator<string[]> {
  let keys: string[] = [];
  for await (const key of walk(root)) {
    keys.push(key);
    if (keys.length === 100) {
      yield keys;
      keys = [];
    }
  }
  if (keys.length) yield keys;
}

export async function requestStorageScan(
  db: Kysely<DB>,
  mode: 'full' | 'changed' | 'publish',
  userId?: string,
) {
  const id = randomUUID();
  await sql`insert into storage_scan_runs(id,mode,requested_by) values(${id}::uuid,${mode},${userId ?? null}::uuid)`.execute(
    db,
  );
  return id;
}

/** Bounded batches, durable cursor and a database lock shared by every worker using this volume. */
export async function reconcileStorage(
  db: Kysely<DB>,
  root: string,
  runId: string,
  limit = 5000,
  budgetMs = 20000,
  retention: StorageRetention = {},
): Promise<boolean> {
  return db.connection().execute(async (connection) => {
    const locked = (
      await sql<{
        locked: boolean;
      }>`select pg_try_advisory_lock(hashtext('apmail:storage-metering')) as locked`.execute(
        connection,
      )
    ).rows[0]!.locked;
    if (!locked) return false;
    try {
      const run = (
        await sql<{
          mode: string;
          state: string;
          cursor: string | null;
        }>`select mode,state,cursor from storage_scan_runs where id=${runId}::uuid`.execute(
          connection,
        )
      ).rows[0];
      if (!run || ['completed', 'partial', 'failed'].includes(run.state)) return true;
      await sql`update storage_scan_runs set state='running',started_at=coalesce(started_at,now()) where id=${runId}::uuid`.execute(
        connection,
      );
      if (run.mode === 'publish') {
        await publishStorageUsage(connection, runId, retention);
        await sql`update storage_scan_runs set state='completed',finished_at=now() where id=${runId}::uuid`.execute(
          connection,
        );
        return true;
      }
      const storage = new Storage(root);
      let checked = 0,
        errors = 0;
      const started = Date.now();
      const exhausted = () => checked >= limit || Date.now() - started >= budgetMs;
      const check = async (key: string, revision?: string) => {
        try {
          await observeStorageFile(
            connection,
            key,
            await storage.inspect(key),
            undefined,
            runId,
            revision,
          );
        } catch {
          errors++;
          const existing = await connection
            .selectFrom('storage_assets')
            .select('id')
            .where('storage_key', '=', key)
            .executeTakeFirst();
          if (!existing) await observeStorageFile(connection, key, null, undefined, runId);
          await sql`update storage_assets set state='unreadable',last_scan_id=${runId}::uuid where storage_key=${key}`.execute(
            connection,
          );
        }
        checked++;
      };
      // Reopening the streamed inventory on retry is safe: already observed keys are skipped.
      // No list of every file is retained in memory or serialized into a queue job.
      if (run.mode === 'full' && (!run.cursor || run.cursor === 'inventory')) {
        try {
          const rootStats = await lstat(root);
          if (!rootStats.isDirectory() || rootStats.isSymbolicLink())
            throw new Error('unsafe_root');
          for await (const keys of inventoryBatches(root)) {
            const assets = (
              await sql<{
                storage_key: string;
                revision: string;
                last_scan_id: string | null;
              }>`select storage_key,revision::text,last_scan_id from storage_assets where storage_key=any(${keys}::text[])`.execute(
                connection,
              )
            ).rows;
            const previous = new Map(assets.map((v) => [v.storage_key, v]));
            for (const key of keys) {
              const asset = previous.get(key);
              if (asset?.last_scan_id === runId) continue;
              await check(key, asset?.revision);
              if (exhausted()) {
                await sql`update storage_scan_runs set cursor='inventory',checked_files=checked_files+${checked},error_count=error_count+${errors} where id=${runId}::uuid`.execute(
                  connection,
                );
                return false;
              }
            }
          }
        } catch {
          // Failed directory traversal must not turn all unseen files into zero bytes.
          await sql`update storage_scan_runs set state='partial',error_code='inventory_unavailable',finished_at=now(),checked_files=checked_files+${checked},error_count=error_count+${errors + 1} where id=${runId}::uuid`.execute(
            connection,
          );
          return true;
        }
        await sql`update storage_scan_runs set cursor='metadata:' where id=${runId}::uuid`.execute(
          connection,
        );
      }
      let cursor = run.cursor?.startsWith('metadata:') ? run.cursor.slice(9) : '';
      while (!exhausted()) {
        const batch = (
          await sql<{
            storage_key: string;
            revision: string;
          }>`select storage_key,revision::text from storage_assets
          where storage_key>${cursor} and state<>'deleted'
          and (${run.mode === 'full'} and (last_scan_id is distinct from ${runId}::uuid or updated_at>observed_at)
            or ${run.mode !== 'full'} and (observed_at is null or updated_at>observed_at or state in ('missing','unreadable')))
          order by storage_key limit ${Math.min(100, limit - checked)}`.execute(connection)
        ).rows;
        if (!batch.length) {
          await sql`update storage_scan_runs set checked_files=checked_files+${checked},error_count=error_count+${errors},cursor=null where id=${runId}::uuid`.execute(
            connection,
          );
          await refreshDiscrepancies(connection);
          await publishStorageUsage(connection, runId, retention);
          return true;
        }
        for (const asset of batch) {
          await check(asset.storage_key, asset.revision);
          cursor = asset.storage_key;
        }
      }
      await sql`update storage_scan_runs set cursor=${'metadata:' + cursor},checked_files=checked_files+${checked},error_count=error_count+${errors} where id=${runId}::uuid`.execute(
        connection,
      );
      return false;
    } finally {
      await sql`select pg_advisory_unlock(hashtext('apmail:storage-metering'))`.execute(connection);
    }
  });
}

export async function refreshDiscrepancies(db: Kysely<DB>) {
  await sql`with issues as (
    select s.id,s.tenant_id,s.mailbox_id,'missing_file' as code from storage_assets s where s.state in ('missing','deleted') and exists(select 1 from storage_asset_refs r where r.asset_id=s.id)
    union all select id,tenant_id,mailbox_id,'unreadable_file' from storage_assets where state='unreadable'
    union all select s.id,s.tenant_id,s.mailbox_id,'size_mismatch' from storage_assets s where state='present' and expected_bytes is not null and expected_bytes<>present_bytes
    union all select s.id,s.tenant_id,s.mailbox_id,case when category='temporary' then 'temporary_file' else 'unreferenced_file' end from storage_assets s
      where state='present' and created_at<now()-interval '5 minutes' and not exists(select 1 from storage_asset_refs r where r.asset_id=s.id)
      and not exists(select 1 from storage_operations o where o.storage_key=s.storage_key and o.state='pending')
    union all select s.id,s.tenant_id,s.mailbox_id,'cross_tenant_reference' from storage_assets s where
      (select count(distinct tenant_id) from storage_asset_refs r where r.asset_id=s.id)>1
      or exists(select 1 from storage_assets other where other.physical_key=s.physical_key and other.tenant_id<>s.tenant_id)
    union all select s.id,s.tenant_id,s.mailbox_id,'interrupted_operation' from storage_assets s where exists(select 1 from storage_operations o where o.storage_key=s.storage_key and ((o.state='failed' and (s.observed_at is null or s.observed_at<=o.finished_at)) or (o.state='pending' and o.created_at<now()-interval '5 minutes')))
  ), cleared as (update storage_discrepancies d set resolved_at=now() where resolved_at is null and not exists(select 1 from issues i where i.id=d.asset_id and i.code=d.code))
  insert into storage_discrepancies(asset_id,tenant_id,mailbox_id,code) select id,tenant_id,mailbox_id,code from issues
  on conflict(asset_id,code) do update set last_seen_at=now(),resolved_at=null,tenant_id=excluded.tenant_id,mailbox_id=excluded.mailbox_id`.execute(
    db,
  );
}
