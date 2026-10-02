import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { writeFile } from 'node:fs/promises';
import pino from 'pino';
import { createQueues, createDb, Storage, audit, asJson } from '@apmail/db';
import { Emitter } from '@socket.io/redis-emitter';
import { handleMailboxConnection } from './handlers/mailbox-connection.js';
import { handleMailboxSync } from './handlers/mailbox-sync.js';
import { handleMailAction } from './handlers/mail-actions.js';
import { handleOutboxSend } from './handlers/outbox-send.js';
import { handleRulesApply } from './handlers/rules-apply.js';
import { recomputeAll } from './handlers/recompute-all.js';
import { sweepOutbox, cleanupUploads } from './handlers/outbox-maintenance.js';
import { ensureSchedulers } from './handlers/ensure-schedulers.js';
import { closeImapConnections } from './imap/connect.js';
import { createSystemEmailHandler } from './handlers/system-email.js';
import { QUEUE_NAMES, socketRedisKey } from '@apmail/shared';
import { readEnv } from './env.js';
const env = readEnv();
let stopping = false;
const db = createDb(env.DATABASE_URL);
const sendSystemEmail = createSystemEmailHandler(env, db);
const log = pino({
  level: env.LOG_LEVEL,
  redact: ['password', 'token', 'body', 'encrypted_password'],
});
const resources = createQueues(env.REDIS_URL);
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const r = {
  db,
  redis: connection,
  queues: resources.queues,
  io: new Emitter(connection, { key: socketRedisKey(env.REDIS_URL) }),
  log,
  env,
  storage: new Storage(env.STORAGE_DIR),
};
const workers = QUEUE_NAMES.map(
  (name) =>
    new Worker(
      name,
      async (job) => {
        if (name === 'system-email') return sendSystemEmail(job.name, job.data);
        if (name === 'mailbox-connection') return handleMailboxConnection(r, job.data.mailbox_id);
        if (name === 'mailbox-sync') return handleMailboxSync(r, job.data.mailbox_id, job.id!);
        if (name === 'outbox-send') return handleOutboxSend(r, job.data.outbox_id, job);
        if (name === 'rules-apply')
          return handleRulesApply(
            r,
            job.data.rule_id ?? job.data.ruleId,
            job.data.since_days ?? job.data.sinceDays ?? 30,
            job.id!,
          );
        if (name === 'mail-actions')
          return handleMailAction(
            r,
            job.data.action_id,
            job.id!,
            job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
          );
        if (name === 'maintenance' && job.name === 'ensure-schedulers') return ensureSchedulers(r);
        if (name === 'maintenance' && job.name === 'sweep-outbox') return sweepOutbox(r);
        if (name === 'maintenance' && job.name === 'cleanup-uploads') return cleanupUploads(r);
        if (name === 'maintenance' && job.name === 'recompute-all') return recomputeAll(r);
        if (name === 'maintenance' && job.name === 'cleanup-auth') {
          const now = new Date();
          const expired = await db
            .updateTable('support_sessions')
            .set({ ended_at: now })
            .where('ended_at', 'is', null)
            .where('expires_at', '<=', now)
            .returning(['id', 'tenant_id', 'user_id'])
            .execute();
          for (const support of expired) {
            await db
              .insertInto('platform_audit')
              .values({
                actor_id: support.user_id,
                tenant_id: support.tenant_id,
                action: 'platform.support_expired',
                metadata: asJson({ support_id: support.id }),
              })
              .execute();
            await audit(db, {
              tenantId: support.tenant_id,
              actorId: support.user_id,
              action: 'platform.support_expired',
              entityType: 'support',
              entityId: support.id,
            });
          }
          await db
            .deleteFrom('operational_logs')
            .where('created_at', '<', new Date(Date.now() - 30 * 86400000))
            .execute();
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
      {
        connection,
        prefix: 'apmail',
        settings: {
          backoffStrategy: (attemptsMade) => {
            const custom =
              env.NODE_ENV !== 'production' && env.WORKER_SEND_BACKOFF_MS
                ? env.WORKER_SEND_BACKOFF_MS.split(',')
                    .map(Number)
                    .filter((n) => Number.isFinite(n) && n > 0)
                : [];
            const delays = custom.length ? custom : [60000, 300000, 900000];
            return delays[attemptsMade - 1] ?? delays.at(-1)!;
          },
        },
        concurrency:
          name === 'maintenance'
            ? 1
            : name === 'mailbox-connection'
              ? 3
              : name === 'mailbox-sync'
                ? env.WORKER_SYNC_CONCURRENCY
                : name === 'outbox-send'
                  ? env.WORKER_SEND_CONCURRENCY
                  : name === 'rules-apply'
                    ? 1
                    : name === 'mail-actions'
                      ? env.WORKER_ACTIONS_CONCURRENCY
                      : 2,
      },
    ),
);
for (const worker of workers)
  worker.on('error', (error) => log.error({ err: error, queue: worker.name }, 'Falha no worker.'));
for (const worker of workers)
  worker.on('failed', (job) => {
    void db
      .insertInto('operational_logs')
      .values({
        service: 'worker',
        level: 'error',
        message: 'Tarefa não concluída.',
        request_id: job?.id ?? null,
        metadata: asJson({ queue: worker.name, attempts: job?.attemptsMade ?? 0 }),
      })
      .execute()
      .catch(() => undefined);
  });
async function registerMaintenance() {
  if (!(await connection.exists('apmail:recompute:v5'))) {
    const previous = await resources.queues.maintenance.getJob('recompute-v5');
    if (previous && ['completed', 'failed'].includes(await previous.getState()))
      await previous.remove();
    await resources.queues.maintenance.add(
      'recompute-all',
      {},
      { jobId: 'recompute-v5', attempts: 3 },
    );
  }
  for (const [name, every] of [
    ['sweep-outbox', 60000],
    ['ensure-schedulers', 300000],
    ['cleanup-uploads', 3600000],
    ['cleanup-auth', 86400000],
  ] as const) {
    if (!(await resources.queues.maintenance.getJobScheduler(name)))
      await resources.queues.maintenance.upsertJobScheduler(name, { every }, { name, data: {} });
  }
  await resources.queues.maintenance.add('ensure-schedulers', {});
}
await registerMaintenance();
// FLUSHDB não fecha a conexão: um watchdog também recupera os schedulers
// quando seus dados desaparecem sem gerar o evento ready.
let watching = false;
const watchdog = setInterval(() => {
  if (watching || stopping) return;
  watching = true;
  void registerMaintenance()
    .then(() => sweepOutbox(r))
    .catch(() => log.warn('Aguardando recuperação das filas.'))
    .finally(() => {
      watching = false;
    });
}, 60000);
// Restaura também os agendadores de manutenção após perda de dados do Redis.
let restoring = false;
connection.on('ready', () => {
  if (restoring) return;
  restoring = true;
  void registerMaintenance()
    .then(() => ensureSchedulers(r))
    .catch(() => log.warn('Aguardando restauração do Redis.'))
    .finally(() => {
      restoring = false;
    });
});
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
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(timer);
    clearInterval(watchdog);
    const timeout = setTimeout(() => process.exit(1), 30000);
    timeout.unref();
    await Promise.all(workers.map((worker) => worker.close()));
    closeImapConnections();
    await resources.close();
    await connection.quit();
    await db.destroy();
    clearTimeout(timeout);
    process.exit(0);
  });
