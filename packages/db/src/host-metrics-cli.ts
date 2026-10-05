// Runs on the host with read-only permission to explicitly configured directories/cgroups.
// No Docker socket, database credentials, file contents or elevated container are required.
import { readFile, writeFile, rename, mkdir, lstat, statfs, opendir } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hostMetricsSchema } from '@apmail/shared';
type SourceConfig = {
  id: 'storage' | 'database' | 'redis' | 'backups' | 'logs' | 'api' | 'worker' | 'web';
  directory?: string;
  cgroup?: string;
};
const config: unknown = JSON.parse(await readFile(process.argv[2] ?? '', 'utf8'));
if (
  typeof config !== 'object' ||
  config === null ||
  !('output' in config) ||
  !('sources' in config)
)
  throw Error('Configuração inválida.');
const raw = config as { output: unknown; sources: unknown; backupReport?: unknown };
if (
  typeof raw.output !== 'string' ||
  !isAbsolute(raw.output) ||
  !Array.isArray(raw.sources) ||
  raw.sources.length > 8
)
  throw Error('Configuração inválida.');
const sources = raw.sources as SourceConfig[],
  result = [];
if (new Set(sources.map((s) => s.id)).size !== sources.length) throw Error('Fontes duplicadas.');
const previous = await readFile(raw.output, 'utf8')
  .then((v) => hostMetricsSchema.safeParse(JSON.parse(v)))
  .catch(() => null);
for (const source of sources) {
  if (
    (!source.directory && !source.cgroup) ||
    !['storage', 'database', 'redis', 'backups', 'logs', 'api', 'worker', 'web'].includes(
      source.id,
    ) ||
    ![source.directory, source.cgroup]
      .filter(Boolean)
      .every((v) => typeof v === 'string' && isAbsolute(v) && resolve(v) !== resolve('/'))
  )
    throw Error('Fonte inválida.');
  const item = {
    id: source.id,
    available: false,
    quality: 'unavailable' as 'verified' | 'partial' | 'unavailable',
    apparent_bytes: null as string | null,
    allocated_bytes: null as string | null,
    files: null as number | null,
    capacity_bytes: null as string | null,
    free_bytes: null as string | null,
    device: null as string | null,
    memory_bytes: null as string | null,
    memory_limit_bytes: null as string | null,
    cpu_usage_microseconds: null as string | null,
    cpu_percent: null as number | null,
  };
  const started = Date.now();
  try {
    if (source.directory) {
      if ((await lstat(source.directory)).isSymbolicLink()) throw Error('link');
      let bytes = 0n,
        allocated = 0n,
        files = 0;
      const seen = new Set<string>();
      const visit = async (directory: string): Promise<void> => {
        for await (const entry of await opendir(directory)) {
          if (Date.now() - started > 20000 || files >= 1000000) throw Error('budget');
          const key = resolve(directory, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) await visit(key);
          else if (entry.isFile()) {
            const s = await lstat(key, { bigint: true }),
              id = `${s.dev}:${s.ino}`;
            if (!seen.has(id)) {
              seen.add(id);
              bytes += s.size;
              allocated += s.blocks * 512n;
              files++;
            }
          }
        }
      };
      await visit(source.directory);
      const fs = await statfs(source.directory, { bigint: true }),
        s = await lstat(source.directory, { bigint: true });
      Object.assign(item, {
        apparent_bytes: String(bytes),
        allocated_bytes: process.platform === 'linux' ? String(allocated) : null,
        files,
        capacity_bytes: String(fs.blocks * fs.bsize),
        free_bytes: String(fs.bavail * fs.bsize),
        device: String(s.dev),
      });
    }
    if (source.cgroup) {
      const numeric = async (name: string) => {
        const v = (await readFile(resolve(source.cgroup!, name), 'utf8')).trim();
        return /^\d+$/.test(v) ? v : null;
      };
      item.memory_bytes = await numeric('memory.current');
      item.memory_limit_bytes = await numeric('memory.max');
      item.cpu_usage_microseconds =
        /^usage_usec (\d+)$/m.exec(
          await readFile(resolve(source.cgroup, 'cpu.stat'), 'utf8'),
        )?.[1] ?? null;
      const old = previous?.success
        ? previous.data.sources.find((v) => v.id === source.id)
        : undefined;
      const elapsed = previous?.success
        ? Date.now() - new Date(previous.data.measured_at).getTime()
        : 0;
      if (old?.cpu_usage_microseconds && item.cpu_usage_microseconds && elapsed >= 1000) {
        const delta = BigInt(item.cpu_usage_microseconds) - BigInt(old.cpu_usage_microseconds);
        if (delta >= 0n) item.cpu_percent = Number((delta * 10000n) / BigInt(elapsed * 1000)) / 100;
      }
    }
    item.available = true;
    item.quality = 'verified';
  } catch {
    item.quality = 'partial';
  }
  result.push(item);
}
let backup = null;
if (raw.backupReport !== undefined) {
  if (
    typeof raw.backupReport !== 'string' ||
    !isAbsolute(raw.backupReport) ||
    resolve(raw.backupReport) === resolve('/')
  )
    throw Error('Relatório de backup inválido.');
  backup = await readFile(raw.backupReport, 'utf8')
    .then((v) => hostMetricsSchema.shape.backup.parse(JSON.parse(v)))
    .catch(() => null);
}
const report = hostMetricsSchema.parse({
  version: 1,
  measured_at: new Date().toISOString(),
  sources: result,
  backup,
});
await mkdir(dirname(raw.output), { recursive: true });
const temporary = raw.output + '.' + randomUUID() + '.tmp';
await writeFile(temporary, JSON.stringify(report), { mode: 0o644, flag: 'wx' });
await rename(temporary, raw.output);
console.log('Coleta concluída:', report.sources.map((v) => v.id + ':' + v.quality).join(', '));
