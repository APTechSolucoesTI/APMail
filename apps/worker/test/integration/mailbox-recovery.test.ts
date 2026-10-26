import { beforeAll, afterAll, beforeEach, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import { Worker } from 'bullmq';
import { setTimeout as delay } from 'node:timers/promises';
import pino from 'pino';
import { createDb, migrate, createQueues, Storage, writeMailboxCredential } from '@apmail/db';
import { handleMailboxConnection } from '../../src/handlers/mailbox-connection.js';
import { handleMailboxSync } from '../../src/handlers/mailbox-sync.js';
import { markMailboxError, enqueueMailboxRecovery } from '../../src/handlers/mailbox-health.js';
import { ensureSchedulers } from '../../src/handlers/ensure-schedulers.js';
import { envSchema } from '../../src/env.js';
import type { WorkerResources } from '../../src/resources.js';
import type { Mailbox } from '../../src/imap/connect.js';

const probes = vi.hoisted(() => ({
  connect: vi.fn(async () => {}),
  smtp: vi.fn(async () => {}),
  source: Buffer.alloc(0),
  real: false,
}));
vi.mock('../../src/imap/connect.js', async (original) => {
  const actual = await original<typeof import('../../src/imap/connect.js')>();
  return {
    ...actual,
    transports: async (...args: Parameters<typeof actual.transports>) =>
      probes.real
        ? actual.transports(...args)
        : {
            imap: {
              connect: probes.connect,
              mailbox: { uidValidity: 1, uidNext: 3 },
              getMailboxLock: async () => ({ release: () => {} }),
              search: async () => [2],
              fetchAll: async () => [{ uid: 2, size: probes.source.length }],
              fetchOne: async () => ({
                uid: 2,
                seq: 2,
                size: probes.source.length,
                source: probes.source,
                flags: new Set(),
              }),
            },
            smtp: { verify: probes.smtp },
            close: async () => {},
          },
  };
});
vi.mock('../../src/imap/provider-quota.js', () => ({ refreshProviderQuota: async () => {} }));
vi.mock('../../src/imap/sync-folders.js', () => ({
  syncFolders: async (r: WorkerResources, box: Mailbox) =>
    r.db.selectFrom('folders').selectAll().where('mailbox_id', '=', box.id).execute(),
}));
vi.mock('../../src/handlers/rules-apply.js', () => ({ applyPendingRules: async () => {} }));
const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test') || !redisUrl)
  throw Error('Banco e fila exclusivos de QA obrigatórios.');
const db = createDb(url),
  tenant = randomUUID(),
  user = randomUUID(),
  created: string[] = [];
const root = await mkdtemp(join(tmpdir(), 'apmail-recovery-'));
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null }),
  resources = createQueues(redisUrl);
const secret = Buffer.alloc(32, 42).toString('base64');
const r: WorkerResources = {
  db,
  redis,
  queues: resources.queues,
  io: new Emitter(redis),
  log: pino({ level: 'silent' }),
  storage: new Storage(root, db),
  env: envSchema.parse({
    NODE_ENV: 'development',
    DATABASE_URL: url,
    REDIS_URL: redisUrl,
    APP_URL: 'http://localhost:5173',
    SESSION_SECRET: secret,
    CREDENTIALS_ENCRYPTION_KEY: secret,
    STORAGE_DIR: root,
    ALLOW_INSECURE_TLS_HOSTS: '127.0.0.1',
  }),
};
beforeAll(async () => {
  await migrate(url);
  await db
    .insertInto('tenants')
    .values({ id: tenant, name: 'Recovery QA', slug: 'recovery-' + tenant })
    .execute();
  await db
    .insertInto('users')
    .values({ id: user, email: user + '@example.test', full_name: 'QA', password_hash: 'fixture' })
    .execute();
  await db
    .insertInto('tenant_members')
    .values({ tenant_id: tenant, user_id: user, role: 'owner' })
    .execute();
});
beforeEach(() => {
  probes.real = false;
  probes.connect.mockReset().mockResolvedValue(undefined);
  probes.smtp.mockReset().mockResolvedValue(undefined);
});

it('reconecta IMAP por TCP real após o servidor encerrar a sessão', async () => {
  let dropping = true;
  const server = createServer((socket) => {
    socket.on('error', () => {});
    if (dropping) {
      socket.destroy();
      return;
    }
    socket.write('* OK IMAP QA ready\r\n');
    let input = '';
    socket.on('data', (chunk) => {
      input += chunk.toString();
      for (;;) {
        const end = input.indexOf('\r\n');
        if (end < 0) break;
        const line = input.slice(0, end);
        input = input.slice(end + 2);
        const [tag, cmd] = line.split(' ');
        if (cmd === 'CAPABILITY') socket.write('* CAPABILITY IMAP4rev1\r\n' + tag + ' OK done\r\n');
        else if (cmd === 'LIST') socket.write('* LIST () "/" ""\r\n' + tag + ' OK done\r\n');
        else if (cmd === 'LOGOUT') socket.end('* BYE done\r\n' + tag + ' OK done\r\n');
        else socket.write(tag + ' OK done\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('QA port');
  probes.real = true;
  try {
    const b = await box('pending');
    await db
      .updateTable('mailboxes')
      .set({ imap_port: address.port, imap_secure: false })
      .where('id', '=', b.id)
      .execute();
    await writeMailboxCredential(db, tenant, b.id, 'qa', secret);
    await handleMailboxConnection(r, b.id);
    expect((await get(b.id)).status).toBe('error');
    dropping = false;
    await due(b.id);
    await handleMailboxConnection(r, b.id);
    expect(await get(b.id)).toMatchObject({
      status: 'active',
      connection_failures: 0,
      last_error: null,
    });
  } finally {
    probes.real = false;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 30000);
afterAll(async () => {
  for (const id of created) await r.queues['mailbox-sync'].removeJobScheduler('sync:' + id);
  for (const queue of [r.queues['mailbox-connection'], r.queues['mailbox-sync']]) {
    for (const job of await queue.getJobs(['waiting', 'delayed', 'completed', 'failed']))
      if (created.includes(job.data.mailbox_id)) await job.remove();
  }
  await resources.close();
  await redis.quit();
  await db.destroy();
  await rm(root, { recursive: true, force: true });
});
async function box(status: 'active' | 'pending' = 'active') {
  const row = await db
    .insertInto('mailboxes')
    .values({
      tenant_id: tenant,
      created_by: user,
      name: 'Recovery',
      email_address: randomUUID() + '@example.test',
      username: 'qa',
      imap_host: '127.0.0.1',
      smtp_host: '127.0.0.1',
      receiving_protocol: 'imap',
      status,
      import_started_at: new Date(),
      last_synced_at: new Date('2001-01-01'),
      last_reconciled_at: new Date(),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  created.push(row.id);
  await db
    .insertInto('folders')
    .values({
      tenant_id: tenant,
      mailbox_id: row.id,
      name: 'INBOX',
      imap_path: 'INBOX',
      special_use: 'inbox',
      last_uid: 1,
      uidvalidity: '1',
      initial_uid_end: 1,
    })
    .execute();
  return row;
}
const get = (id: string) =>
  db.selectFrom('mailboxes').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
const due = (id: string) =>
  db
    .updateTable('mailboxes')
    .set({ next_connection_attempt_at: new Date(0) })
    .where('id', '=', id)
    .execute();
const jobs = async (id: string) =>
  (await r.queues['mailbox-connection'].getJobs(['waiting', 'delayed'])).filter(
    (j) => j.data.mailbox_id === id,
  );

it('recupera uma queda temporária sem ação humana e recebe o próximo e-mail sem perder o cursor', async () => {
  const b = await box();
  await markMailboxError(r, b, { code: 'ECONNRESET' });
  const failed = await get(b.id);
  expect(failed).toMatchObject({
    status: 'error',
    connection_error_kind: 'transient',
    connection_failures: 1,
  });
  expect(failed.next_connection_attempt_at!.getTime() - Date.now()).toBeGreaterThan(10000);
  expect(await jobs(b.id)).toHaveLength(1);
  await due(b.id);
  await handleMailboxConnection(r, b.id);
  expect(await get(b.id)).toMatchObject({
    status: 'active',
    connection_failures: 0,
    last_error: null,
    next_connection_attempt_at: null,
  });
  expect(await r.queues['mailbox-sync'].getJobScheduler('sync:' + b.id)).toBeDefined();
  probes.source = Buffer.from(
    `From: client@example.test\r\nTo: ${b.email_address}\r\nMessage-ID: <${randomUUID()}@qa.example>\r\nSubject: Recebido após reconectar\r\n\r\nConteúdo novo.\r\n`,
  );
  await handleMailboxSync(r, b.id, 'qa-sync');
  const message = await db
    .selectFrom('messages')
    .select(['subject', 'imap_uid'])
    .where('mailbox_id', '=', b.id)
    .executeTakeFirstOrThrow();
  expect(message).toMatchObject({ subject: 'Recebido após reconectar', imap_uid: '2' });
  expect(
    (
      await db
        .selectFrom('folders')
        .select('last_uid')
        .where('mailbox_id', '=', b.id)
        .executeTakeFirstOrThrow()
    ).last_uid,
  ).toBe('2');
  await handleMailboxSync(r, b.id, 'qa-sync-again');
  expect(
    await db.selectFrom('messages').select('id').where('mailbox_id', '=', b.id).execute(),
  ).toHaveLength(1);
});
it('repete falhas transitórias sem limite total, com espera limitada e um alerta por interrupção', async () => {
  const b = await box();
  for (let n = 0; n < 8; n++) {
    await due(b.id);
    await markMailboxError(r, await get(b.id), { code: 'ETIMEDOUT' });
  }
  const failed = await get(b.id);
  expect(failed.connection_failures).toBe(8);
  expect(failed.next_connection_attempt_at!.getTime() - Date.now()).toBeGreaterThan(295000);
  const alerts = await db
    .selectFrom('notifications')
    .select('id')
    .where('tenant_id', '=', tenant)
    .where('link', '=', '/settings/mailboxes/' + b.id)
    .execute();
  expect(alerts).toHaveLength(1);
});
it('mantém o recebimento independente de uma falha SMTP', async () => {
  const b = await box('pending');
  probes.smtp.mockRejectedValue(new Error('SMTP offline'));
  await handleMailboxConnection(r, b.id);
  expect((await get(b.id)).status).toBe('active');
  expect(probes.smtp).not.toHaveBeenCalled();
});
it('respeita a espera de autenticação e evita alertas ou tentativas duplicadas', async () => {
  const b = await box();
  await markMailboxError(r, b, { code: 'EAUTH' });
  const failed = await get(b.id);
  expect(failed.connection_error_kind).toBe('authentication');
  expect(failed.next_connection_attempt_at!.getTime() - Date.now()).toBeGreaterThan(29 * 60000);
  await markMailboxError(r, failed, { code: 'EAUTH' });
  await handleMailboxConnection(r, b.id);
  expect((await get(b.id)).connection_failures).toBe(1);
  expect(probes.connect).not.toHaveBeenCalled();
});
it('recupera pelo banco uma publicação perdida na fila e não duplica trabalhos', async () => {
  const b = await box();
  const add = vi
    .spyOn(r.queues['mailbox-connection'], 'add')
    .mockRejectedValueOnce(new Error('Redis offline'));
  await markMailboxError(r, b, { code: 'ECONNREFUSED' });
  add.mockRestore();
  expect(await jobs(b.id)).toHaveLength(0);
  await ensureSchedulers(r);
  await ensureSchedulers(r);
  expect(await jobs(b.id)).toHaveLength(1);
});
it('não reativa caixa desabilitada durante a conexão', async () => {
  const b = await box('pending');
  probes.connect.mockImplementationOnce(async () => {
    await db
      .updateTable('mailboxes')
      .set({ status: 'disabled', connection_revision: 1 })
      .where('id', '=', b.id)
      .execute();
  });
  await handleMailboxConnection(r, b.id);
  expect((await get(b.id)).status).toBe('disabled');
  expect(await r.queues['mailbox-sync'].getJobScheduler('sync:' + b.id)).toBeUndefined();
});
it('ignora falha de uma configuração antiga e não reativa excluídas ou empresas suspensas', async () => {
  const b = await box('pending');
  await db
    .updateTable('mailboxes')
    .set({ connection_revision: 1 })
    .where('id', '=', b.id)
    .execute();
  await markMailboxError(r, b, { code: 'EAUTH' });
  expect((await get(b.id)).connection_failures).toBe(0);
  await db
    .updateTable('mailboxes')
    .set({ deleted_at: new Date() })
    .where('id', '=', b.id)
    .execute();
  await handleMailboxConnection(r, b.id);
  expect(probes.connect).not.toHaveBeenCalled();
  const suspended = await box('pending');
  await db
    .updateTable('tenants')
    .set({ suspended_at: new Date() })
    .where('id', '=', tenant)
    .execute();
  try {
    await handleMailboxConnection(r, suspended.id);
    await ensureSchedulers(r);
    expect(await jobs(suspended.id)).toHaveLength(0);
    expect(probes.connect).not.toHaveBeenCalled();
  } finally {
    await db.updateTable('tenants').set({ suspended_at: null }).where('id', '=', tenant).execute();
  }
});
it('uma indisponibilidade Redis após reconectar não declara queda do provedor', async () => {
  const b = await box('pending');
  const fail = vi
    .spyOn(r.queues['mailbox-sync'], 'upsertJobScheduler')
    .mockRejectedValueOnce(new Error('Redis offline'));
  await handleMailboxConnection(r, b.id);
  fail.mockRestore();
  expect((await get(b.id)).status).toBe('active');
  await ensureSchedulers(r);
  expect(await r.queues['mailbox-sync'].getJobScheduler('sync:' + b.id)).toBeDefined();
});
it('isola os trabalhos por revisão da configuração e por interrupção', async () => {
  const b = await box();
  await markMailboxError(r, b, { code: 'ECONNRESET' });
  const old = (await jobs(b.id))[0]!.id;
  await db
    .updateTable('mailboxes')
    .set({ connection_revision: 1 })
    .where('id', '=', b.id)
    .execute();
  await enqueueMailboxRecovery(r, await get(b.id));
  expect((await jobs(b.id)).some((j) => j.id !== old)).toBe(true);
});
it('recupera POP3 por TCP real sem validar SMTP nem remover mensagens do provedor', async () => {
  const commands: string[] = [];
  const server = createServer((socket) => {
    socket.write('+OK QA\r\n');
    let input = '';
    socket.on('data', (chunk) => {
      input += chunk.toString();
      for (;;) {
        const end = input.indexOf('\r\n');
        if (end < 0) break;
        const line = input.slice(0, end);
        input = input.slice(end + 2);
        const cmd = line.split(' ')[0]!;
        commands.push(cmd);
        if (cmd === 'QUIT') socket.end('+OK bye\r\n');
        else if (cmd === 'LIST' || cmd === 'UIDL') socket.write('+OK\r\n.\r\n');
        else socket.write('+OK\r\n');
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('QA port');
  try {
    const b = await box();
    await db
      .updateTable('mailboxes')
      .set({ receiving_protocol: 'pop3', imap_port: address.port, imap_secure: false })
      .where('id', '=', b.id)
      .execute();
    await writeMailboxCredential(db, tenant, b.id, 'qa', secret);
    await markMailboxError(r, await get(b.id), { code: 'ECONNRESET' });
    await due(b.id);
    await handleMailboxConnection(r, b.id);
    expect((await get(b.id)).status).toBe('active');
    expect(commands).toContain('UIDL');
    expect(commands).not.toContain('DELE');
    expect(probes.smtp).not.toHaveBeenCalled();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it('executa a reconexão automaticamente pela fila após os 15 segundos, sem comando manual', async () => {
  const b = await box();
  const worker = new Worker(
    'mailbox-connection',
    (job) => (job.data.mailbox_id === b.id ? handleMailboxConnection(r, b.id) : Promise.resolve()),
    { connection: redis, prefix: 'apmail', concurrency: 1 },
  );
  worker.on('error', () => {});
  try {
    await markMailboxError(r, b, { code: 'ECONNRESET' });
    const deadline = Date.now() + 23000;
    while ((await get(b.id)).status !== 'active' && Date.now() < deadline) await delay(200);
    expect((await get(b.id)).status).toBe('active');
    expect(probes.connect).toHaveBeenCalledTimes(1);
  } finally {
    await worker.close();
  }
}, 30000);
