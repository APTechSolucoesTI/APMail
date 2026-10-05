import { readFile, statfs, lstat, opendir } from 'node:fs/promises';
import path from 'node:path';
import { sql, type Kysely } from 'kysely';
import type { Redis } from 'ioredis';
import type { DB } from './types.js';
import { hostMetricsSchema } from '@apmail/shared';

async function directoryUsage(root?: string) {
  if (!root) return { available: false, bytes: null, files: null, quality: 'unavailable' };
  let bytes = 0n,
    files = 0;
  const started = Date.now(),
    identities = new Set<string>();
  async function visit(dir: string): Promise<void> {
    if (Date.now() - started > 10000 || files > 100000) throw new Error('budget');
    for await (const entry of await opendir(dir)) {
      if (Date.now() - started > 10000 || files > 100000) throw new Error('budget');
      if (entry.isSymbolicLink()) continue;
      const item = path.join(dir, entry.name);
      if (entry.isDirectory()) await visit(item);
      else if (entry.isFile()) {
        const s = await lstat(item, { bigint: true }),
          key = `${s.dev}:${s.ino}`;
        if (!identities.has(key)) {
          identities.add(key);
          bytes += s.size;
          files++;
        }
      }
    }
  }
  try {
    if ((await lstat(root)).isSymbolicLink()) throw new Error('link');
    await visit(root);
    return { available: true, bytes: String(bytes), files, quality: 'verified' };
  } catch {
    return { available: false, bytes: null, files: null, quality: 'partial' };
  }
}
async function optionalNumber(file: string): Promise<string | null> {
  try {
    const value = (await readFile(file, 'utf8')).trim();
    return /^\d+$/.test(value) ? value : null;
  } catch {
    return null;
  }
}
export async function collectPlatformResources(
  db: Kysely<DB>,
  redis: Redis,
  root: string,
  options: {
    backupDir?: string;
    logDir?: string;
    redisDir?: string;
    hostMetricsFile?: string;
    serviceName?: 'worker' | 'cli';
  } = {},
) {
  const disk = await statfs(root, { bigint: true })
    .then(async (s) => ({
      available: true,
      total_bytes: String(s.blocks * s.bsize),
      free_bytes: String(s.bavail * s.bsize),
      used_bytes: String((s.blocks - s.bfree) * s.bsize),
      filesystem_type: String(s.type),
      device: String((await lstat(root, { bigint: true })).dev),
    }))
    .catch(() => ({
      available: false,
      total_bytes: null,
      free_bytes: null,
      used_bytes: null,
      filesystem_type: null,
      device: null,
    }));
  const relations = (
    await sql<{
      table_bytes: string;
      index_bytes: string;
      toast_bytes: string;
      database_bytes: string;
    }>`select
    coalesce(sum(pg_table_size(c.oid)-coalesce(pg_total_relation_size(nullif(c.reltoastrelid,0)),0)),0)::text as table_bytes,
    coalesce(sum(pg_indexes_size(c.oid)),0)::text as index_bytes,
    coalesce(sum(coalesce(pg_total_relation_size(nullif(c.reltoastrelid,0)),0)),0)::text as toast_bytes,
    pg_database_size(current_database())::text as database_bytes
    from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','m')`.execute(
      db,
    )
  ).rows[0]!;
  const wal = await sql<{ bytes: string }>`select sum(size)::text as bytes from pg_ls_waldir()`
    .execute(db)
    .then((r) => r.rows[0]?.bytes ?? null)
    .catch(() => null);
  const info = await redis.info('memory').catch(() => ''),
    persisted = await redis.info('persistence').catch(() => '');
  const field = (source: string, name: string) =>
    new RegExp(`^${name}:(\\d+)`, 'm').exec(source)?.[1] ?? null;
  const resources = {
    disk,
    database: { available: true, ...relations, wal_bytes: wal, quality: 'verified' },
    redis: {
      available: !!info,
      memory_bytes: field(info, 'used_memory'),
      aof_bytes: field(persisted, 'aof_current_size'),
      disk: await directoryUsage(options.redisDir),
    },
    backups: await directoryUsage(options.backupDir),
    logs: await directoryUsage(options.logDir),
    worker: {
      source: options.serviceName ?? 'worker',
      available: true,
      rss_bytes: String(process.memoryUsage().rss),
      heap_bytes: String(process.memoryUsage().heapUsed),
      cpu_user_microseconds: String(process.cpuUsage().user),
      cpu_system_microseconds: String(process.cpuUsage().system),
      container_memory_bytes: await optionalNumber('/sys/fs/cgroup/memory.current'),
      container_memory_limit_bytes: await optionalNumber('/sys/fs/cgroup/memory.max'),
      uptime_seconds: Math.floor(process.uptime()),
    },
  };
  await sql`insert into platform_metric_samples(source,metrics) values('infrastructure',${JSON.stringify(resources)}::jsonb)`.execute(
    db,
  );
  if (options.hostMetricsFile) {
    const report = await readFile(options.hostMetricsFile, 'utf8')
      .then((v) => hostMetricsSchema.safeParse(JSON.parse(v)))
      .catch(() => null);
    if (report?.success && new Date(report.data.measured_at).getTime() <= Date.now() + 60000)
      await sql`insert into platform_metric_samples(source,measured_at,metrics) select 'host',${report.data.measured_at}::timestamptz,${JSON.stringify(report.data)}::jsonb
        where not exists(select 1 from platform_metric_samples where source='host' and measured_at=${report.data.measured_at}::timestamptz)`.execute(
        db,
      );
  }
  await sql`delete from platform_metric_samples where measured_at<now()-interval '90 days'`.execute(
    db,
  );
  return resources;
}
