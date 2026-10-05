import {
  loadRootEnv,
  createDb,
  requestStorageScan,
  reconcileStorage,
  collectPlatformResources,
  resolveWorkspacePath,
} from './index.js';
import { Redis } from 'ioredis';
loadRootEnv();
const mode = process.argv[2] ?? 'full';
if (!['full', 'changed', 'publish'].includes(mode)) throw Error('Use full, changed ou publish.');
if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
  throw Error('Configure o ambiente do projeto.');
const db = createDb(process.env.DATABASE_URL),
  redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1 });
const root = resolveWorkspacePath(process.env.STORAGE_DIR ?? './.data/storage');
try {
  const id = await requestStorageScan(db, mode as 'full' | 'changed' | 'publish');
  console.log('Reconciliação iniciada:', id);
  let done = false;
  while (!done) {
    done = await reconcileStorage(db, root, id, 5000, 20000, {
      hourlyDays: Number(process.env.STORAGE_HISTORY_HOURLY_DAYS ?? 90),
      dailyMonths: Number(process.env.STORAGE_HISTORY_DAILY_MONTHS ?? 24),
    });
    const run = await db
      .selectFrom('storage_scan_runs')
      .select(['state', 'checked_files', 'error_count'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    console.log(JSON.stringify(run));
    if (!done) await new Promise((resolve) => setTimeout(resolve, 1000));
    if (done && run.state !== 'completed') process.exitCode = 1;
  }
  await collectPlatformResources(db, redis, root, {
    backupDir: process.env.BACKUP_METRICS_DIR,
    logDir: process.env.LOG_METRICS_DIR,
    redisDir: process.env.REDIS_METRICS_DIR,
    hostMetricsFile: process.env.INFRA_METRICS_FILE,
    serviceName: 'cli',
  });
} finally {
  await redis.quit();
  await db.destroy();
}
