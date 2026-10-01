import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { writeFile } from 'node:fs/promises';
import pino from 'pino';
import { createQueues, createDb } from '@apmail/db';
import { createSystemEmailHandler } from './handlers/system-email.js';
import { QUEUE_NAMES } from '@apmail/shared';
import { readEnv } from './env.js';
const env = readEnv();
const db = createDb(env.DATABASE_URL);
const sendSystemEmail = createSystemEmailHandler(env);
const log = pino({
  level: env.LOG_LEVEL,
  redact: ['password', 'token', 'body', 'encrypted_password'],
});
const resources = createQueues(env.REDIS_URL);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const workers = QUEUE_NAMES.map(
  (name) =>
    new Worker(
      name,
      async (job) => {
        if (name === 'system-email') return sendSystemEmail(job.name, job.data);
        if (name === 'maintenance' && job.name === 'cleanup-auth') {
          const now = new Date();
          await db.deleteFrom('sessions').where('expires_at', '<', now).execute();
          await db.deleteFrom('password_reset_tokens').where('expires_at', '<', now).execute();
          await db
            .deleteFrom('invitations')
            .where('expires_at', '<', now)
            .where('accepted_at', 'is', null)
            .execute();
          return;
        }
        log.info(
          { queue: name, job_id: job.id, name: job.name },
          'Handler reservado para a próxima fase.',
        );
      },
      { connection, prefix: 'apmail', concurrency: name === 'maintenance' ? 1 : 2 },
    ),
);
for (const worker of workers)
  worker.on('error', (error) => log.error({ err: error, queue: worker.name }, 'Falha no worker.'));
for (const [name, every] of [
  ['sweep-outbox', 60000],
  ['ensure-schedulers', 300000],
  ['cleanup-uploads', 3600000],
  ['cleanup-auth', 86400000],
] as const) {
  await resources.queues.maintenance.upsertJobScheduler(name, { every }, { name, data: {} });
}
await resources.queues.maintenance.add('ensure-schedulers', {});
async function heartbeat(): Promise<void> {
  await connection.set('worker:heartbeat', new Date().toISOString(), 'EX', 90);
  await writeFile(
    process.platform === 'win32' ? `${process.env.TEMP}/apmail-heartbeat` : '/tmp/heartbeat',
    String(Date.now()),
  );
}
await heartbeat();
const timer = setInterval(
  () => void heartbeat().catch((error) => log.error({ err: error }, 'Falha no heartbeat.')),
  30000,
);
log.info('Worker iniciado.');
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    const timeout = setTimeout(() => process.exit(1), 30000);
    timeout.unref();
    await Promise.all(workers.map((worker) => worker.close()));
    await resources.close();
    await connection.quit();
    await db.destroy();
    clearTimeout(timeout);
    process.exit(0);
  });
