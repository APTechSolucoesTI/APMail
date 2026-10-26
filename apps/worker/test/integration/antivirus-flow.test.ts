import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer, type Socket } from 'node:net';
import { sql } from 'kysely';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import pino from 'pino';
import {
  createDb,
  createQueues,
  migrate,
  Storage,
  registerSecurityFile,
  scanSecurityFile,
  antivirusOptions,
  sweepSecurityFiles,
  requestFileRescan,
} from '@apmail/db';
import { envSchema } from '../../src/env.js';
import { ingestMessage } from '../../src/imap/ingest-message.js';
import { handleOutboxSend } from '../../src/handlers/outbox-send.js';
import { handleMailArchive } from '../../src/handlers/mail-archive.js';
import { ensureAntivirusScheduler } from '../../src/handlers/antivirus.js';
import type { WorkerResources } from '../../src/resources.js';

const smtp = vi.hoisted(() => ({ sendMail: vi.fn(async () => undefined) }));
vi.mock('../../src/imap/connect.js', async (original) => ({
  ...(await original<object>()),
  transports: async () => ({ smtp, close: async () => undefined }),
}));
const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test') || !redisUrl)
  throw new Error('Banco e Redis exclusivos de teste obrigatórios.');
const db = createDb(url),
  tenant = randomUUID(),
  user = randomUUID(),
  mailbox = randomUUID();
const dir = await mkdtemp(join(tmpdir(), 'apmail-av-worker-'));
const queues = createQueues(redisUrl),
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const sockets = new Set<Socket>();
let scannedStreams = 0;
const server = createServer((socket) => {
  sockets.add(socket);
  socket.on('close', () => sockets.delete(socket));
  socket.on('error', () => undefined);
  let pending = Buffer.alloc(0),
    command = '',
    content = Buffer.alloc(0);
  socket.on('data', (chunk: Buffer) => {
    pending = Buffer.concat([pending, chunk]);
    if (!command) {
      const end = pending.indexOf(0);
      if (end < 0) return;
      command = pending.subarray(0, end).toString();
      pending = pending.subarray(end + 1);
      if (command === 'zPING') {
        socket.end('PONG\0');
        return;
      }
      if (command === 'zVERSION') {
        socket.end(`ClamAV 1.4.3/27972/${new Date().toUTCString()}\0`);
        return;
      }
    }
    if (command !== 'zINSTREAM') return;
    while (pending.length >= 4) {
      const length = pending.readUInt32BE(0);
      if (!length) {
        scannedStreams++;
        socket.end(
          content.includes(Buffer.from('EICAR'))
            ? 'stream: Eicar-Test-Signature FOUND\0'
            : 'stream: OK\0',
        );
        return;
      }
      if (pending.length < length + 4) return;
      content = Buffer.concat([content, pending.subarray(4, length + 4)]);
      pending = pending.subarray(length + 4);
    }
  });
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Porta local inválida.');
const env = envSchema.parse({
  DATABASE_URL: url,
  REDIS_URL: redisUrl,
  APP_URL: 'http://localhost:5173',
  NODE_ENV: 'test',
  STORAGE_DIR: dir,
  SESSION_SECRET: Buffer.alloc(32).toString('base64'),
  CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  CLAMAV_HOST: '127.0.0.1',
  CLAMAV_PORT: address.port,
});
const r: WorkerResources = {
  db,
  redis,
  queues: queues.queues,
  env,
  storage: new Storage(dir, db),
  io: new Emitter(redis),
  log: pino({ level: 'silent' }),
};
beforeAll(async () => {
  await migrate(url);
  await db
    .insertInto('tenants')
    .values({ id: tenant, name: 'Worker AV QA', slug: 'av-' + tenant })
    .execute();
  await db
    .insertInto('users')
    .values({ id: user, email: user + '@example.test', full_name: 'QA', password_hash: 'not-used' })
    .execute();
  await db
    .insertInto('tenant_members')
    .values({ tenant_id: tenant, user_id: user, role: 'owner', status: 'active' })
    .execute();
  await db
    .insertInto('mailboxes')
    .values({
      id: mailbox,
      tenant_id: tenant,
      name: 'QA',
      email_address: 'qa@example.test',
      username: 'qa@example.test',
      imap_host: 'localhost',
      smtp_host: 'localhost',
      receiving_protocol: 'pop3',
      status: 'active',
    })
    .execute();
  await db
    .insertInto('folders')
    .values({
      tenant_id: tenant,
      mailbox_id: mailbox,
      name: 'Entrada',
      imap_path: 'INBOX',
      special_use: 'inbox',
    })
    .execute();
  await db
    .insertInto('folders')
    .values({
      tenant_id: tenant,
      mailbox_id: mailbox,
      name: 'Enviados',
      imap_path: 'Sent',
      special_use: 'sent',
    })
    .execute();
});
afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await queues.close();
  await redis.quit();
  await db.destroy();
  await rm(dir, { recursive: true, force: true });
});
const box = () =>
  db.selectFrom('mailboxes').selectAll().where('id', '=', mailbox).executeTakeFirstOrThrow();
const folder = () =>
  db
    .selectFrom('folders')
    .selectAll()
    .where('mailbox_id', '=', mailbox)
    .where('special_use', '=', 'inbox')
    .executeTakeFirstOrThrow();
async function receive(external?: 'pop3' | 'archive', sourceResources = r) {
  const key = randomUUID();
  const fixture = await readFile(new URL('../fixtures/attachments.eml', import.meta.url));
  const source = Buffer.from(
    fixture.toString().replace('<fixture-attachments@cliente.local>', `<${key}@example.test>`),
  );
  const thread = await ingestMessage(
    sourceResources,
    await box(),
    await folder(),
    { seq: 1, uid: Math.floor(Math.random() * 2000000000), source, size: source.length },
    external ? { kind: external, key, historical: true } : undefined,
  );
  const message = await db
    .selectFrom('messages')
    .selectAll()
    .where('thread_id', '=', thread)
    .where('message_id_header', '=', `<${key}@example.test>`)
    .executeTakeFirstOrThrow();
  const files = await db
    .selectFrom('attachments')
    .selectAll()
    .where('message_id', '=', message.id)
    .execute();
  return { message, files };
}
async function queuedOutbox(
  file: { id: string },
  kind: 'message_attachment' | 'upload' = 'message_attachment',
) {
  const id = randomUUID(),
    job = 'av-worker-' + id;
  await db
    .insertInto('outbox')
    .values({
      id,
      tenant_id: tenant,
      mailbox_id: mailbox,
      created_by: user,
      status: 'queued',
      job_id: job,
      send_after: new Date(Date.now() - 1000),
      subject: 'Proteção AV',
      to_addresses: JSON.stringify([{ address: 'sink@example.test' }]),
      attachments: JSON.stringify([
        {
          source: kind,
          ...(kind === 'upload' ? { upload_id: file.id } : { attachment_id: file.id }),
        },
      ]),
    })
    .execute();
  return { id, job };
}
async function scanMessage(id: string) {
  const rows = await db
    .selectFrom('file_security')
    .selectAll()
    .where('message_id', '=', id)
    .execute();
  for (const file of rows) await scanSecurityFile(db, r.storage, file.id, antivirusOptions(env));
}
it.each([undefined, 'pop3', 'archive'] as const)(
  'persiste anexos pendentes antes da fila em recebimento %s',
  async (kind) => {
    const { message, files } = await receive(kind);
    expect(files).toHaveLength(2);
    const security = await db
      .selectFrom('file_security')
      .selectAll()
      .where('message_id', '=', message.id)
      .execute();
    expect(security).toHaveLength(kind ? 3 : 2);
    expect(security.every((file) => file.status === 'pending')).toBe(true);
    const jobs = await r.queues['antivirus-scan'].getJobs(['waiting', 'delayed']);
    for (const file of security) expect(jobs.some((job) => job.data.id === file.id)).toBe(true);
  },
);
it('não perde ingestão quando Redis falha e recupera o trabalho pelo banco', async () => {
  const failing = {
    ...r,
    queues: {
      ...r.queues,
      'antivirus-scan': {
        add: async () => {
          throw new Error('offline');
        },
      },
    },
  } as unknown as WorkerResources;
  const { message } = await receive(undefined, failing);
  const rows = await db
    .selectFrom('file_security')
    .selectAll()
    .where('message_id', '=', message.id)
    .execute();
  expect(rows.every((file) => file.status === 'pending')).toBe(true);
  // Prioritize this recovery fixture ahead of unrelated pending archives in the shared QA DB.
  await db
    .updateTable('file_security')
    .set({ next_attempt_at: new Date('2000-01-01T00:00:00Z') })
    .where(
      'id',
      'in',
      rows.map((file) => file.id),
    )
    .execute();
  await sweepSecurityFiles(db, r.queues['antivirus-scan']);
  const jobs = await r.queues['antivirus-scan'].getJobs(['waiting', 'delayed']);
  expect(rows.every((file) => jobs.some((job) => job.data.id === file.id))).toBe(true);
});
it('a transação revertida não deixa anexo nem veredito órfão', async () => {
  const source = await readFile(new URL('../fixtures/attachments.eml', import.meta.url));
  const key = randomUUID();
  await expect(
    ingestMessage(
      r,
      await box(),
      await folder(),
      { seq: 1, uid: 1, source },
      {
        kind: 'archive',
        key,
        historical: true,
        persisted: async () => {
          throw new Error('rollback-qa');
        },
      },
    ),
  ).rejects.toThrow('rollback-qa');
  const rows = await db.selectFrom('messages').select('id').where('source_key', '=', key).execute();
  expect(rows).toEqual([]);
  const orphan = await sql<{ count: string }>`select count(*)::text as count from file_security f
    where f.tenant_id=${tenant} and f.kind in ('attachment','mail_raw') and not exists(select 1 from messages m where m.id=f.message_id)`.execute(
    db,
  );
  expect(orphan.rows[0]?.count).toBe('0');
});
it('bloqueia SMTP pendente e envia só após veredito, herdando evidência na cópia Enviados', async () => {
  const { message, files } = await receive();
  const outbox = await queuedOutbox(files[0]!);
  const before = smtp.sendMail.mock.calls.length;
  await expect(
    handleOutboxSend(r, outbox.id, { id: outbox.job, attemptsMade: 0, opts: { attempts: 3 } }),
  ).rejects.toThrow(/aguarda análise/);
  expect(smtp.sendMail.mock.calls.length).toBe(before);
  expect(
    (
      await db
        .selectFrom('outbox')
        .select('status')
        .where('id', '=', outbox.id)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('queued');
  await scanMessage(message.id);
  const scansBefore = scannedStreams;
  await handleOutboxSend(r, outbox.id, { id: outbox.job, attemptsMade: 1, opts: { attempts: 3 } });
  expect(smtp.sendMail.mock.calls.length).toBe(before + 1);
  expect(scannedStreams).toBe(scansBefore);
  const sent = await db
    .selectFrom('outbox')
    .select(['status', 'sent_message_id'])
    .where('id', '=', outbox.id)
    .executeTakeFirstOrThrow();
  expect(sent.status).toBe('sent');
  const copy = await db
    .selectFrom('attachments')
    .selectAll()
    .where('message_id', '=', sent.sent_message_id!)
    .executeTakeFirstOrThrow();
  expect(copy).toMatchObject({
    filename: files[0]!.filename,
    content_type: files[0]!.content_type,
    size_bytes: files[0]!.size_bytes,
    content_id: files[0]!.content_id,
    is_inline: files[0]!.is_inline,
  });
  const verdicts = await db
    .selectFrom('file_security')
    .selectAll()
    .where('storage_key', 'in', [files[0]!.storage_path, copy.storage_path])
    .execute();
  expect(verdicts).toHaveLength(2);
  expect(verdicts.every((v) => v.status === 'clean')).toBe(true);
  expect(verdicts[0]!.sha256).toBe(verdicts[1]!.sha256);
});
it('a quarentena mantém bytes e histórico e encerra envio infectado antes do SMTP', async () => {
  const id = randomUUID(),
    path = `uploads/${tenant}/${id}`;
  const bytes = Buffer.from('EICAR harmless test marker');
  await r.storage.writeFile(path, bytes);
  await db
    .insertInto('uploads')
    .values({
      id,
      tenant_id: tenant,
      user_id: user,
      mailbox_id: mailbox,
      filename: 'eicar.txt',
      content_type: 'text/plain',
      size_bytes: bytes.length,
      storage_path: path,
    })
    .execute();
  const pending = await registerSecurityFile(db, {
    storage_key: path,
    tenant_id: tenant,
    mailbox_id: mailbox,
    user_id: user,
    resource_id: id,
    filename: 'eicar.txt',
    content_type: 'text/plain',
    size_bytes: bytes.length,
    kind: 'upload',
  });
  const result = await scanSecurityFile(db, r.storage, pending.id, antivirusOptions(env));
  expect(result?.status).toBe('infected');
  expect(await r.storage.inspect(path)).not.toBe(null);
  expect(
    await db
      .selectFrom('file_scan_history')
      .select('status')
      .where('file_id', '=', pending.id)
      .executeTakeFirstOrThrow(),
  ).toMatchObject({ status: 'infected' });
  const outbox = await queuedOutbox({ id }, 'upload'),
    before = smtp.sendMail.mock.calls.length;
  await expect(
    handleOutboxSend(r, outbox.id, { id: outbox.job, attemptsMade: 0, opts: { attempts: 3 } }),
  ).rejects.toMatchObject({ name: 'UnrecoverableError' });
  expect(smtp.sendMail.mock.calls.length).toBe(before);
  expect(
    (
      await db
        .selectFrom('outbox')
        .select('status')
        .where('id', '=', outbox.id)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('failed');
});
it('detecta bytes alterados e impede reutilizar um veredito limpo no envio', async () => {
  const { message, files } = await receive();
  await scanMessage(message.id);
  await writeFile(join(dir, files[0]!.storage_path), Buffer.from('EICAR changed bytes'));
  const outbox = await queuedOutbox(files[0]!),
    before = smtp.sendMail.mock.calls.length;
  await expect(
    handleOutboxSend(r, outbox.id, { id: outbox.job, attemptsMade: 0, opts: { attempts: 3 } }),
  ).rejects.toThrow(/aguarda análise/);
  expect(smtp.sendMail.mock.calls.length).toBe(before);
  const verdict = await db
    .selectFrom('file_security')
    .selectAll()
    .where('storage_key', '=', files[0]!.storage_path)
    .executeTakeFirstOrThrow();
  expect(verdict).toMatchObject({ status: 'pending', error_code: 'content_changed', sha256: null });
});
it('motor offline registra erro e mantém o arquivo bloqueado para uma próxima tentativa', async () => {
  const { message } = await receive();
  const file = await db
    .selectFrom('file_security')
    .selectAll()
    .where('message_id', '=', message.id)
    .executeTakeFirstOrThrow();
  const result = await scanSecurityFile(db, r.storage, file.id, {
    ...antivirusOptions(env),
    port: 1,
    connectTimeoutMs: 100,
    timeoutMs: 500,
  });
  expect(result).toMatchObject({ status: 'error', error_code: 'connection_failed' });
  expect(result!.next_attempt_at.getTime()).toBeGreaterThan(Date.now());
  expect(await r.storage.inspect(file.storage_key)).not.toBe(null);
  const requested = await requestFileRescan(db, file.id, tenant);
  expect(requested?.status).toBe('pending');
  expect((await scanSecurityFile(db, r.storage, file.id, antivirusOptions(env)))?.status).toBe(
    'clean',
  );
});
it('a importação conclui e conserva o contêiner pendente, protegendo também o MIME bruto', async () => {
  const id = randomUUID(),
    path = `mail-imports/${tenant}/${mailbox}/${id}/source.eml`;
  const raw = Buffer.from(
    `From: sender@example.test\r\nTo: qa@example.test\r\nMessage-ID: <${id}@example.test>\r\nSubject: Importação pendente\r\n\r\nMensagem segura\r\n`,
  );
  await r.storage.writeFile(path, raw);
  await db
    .insertInto('mail_archive_imports')
    .values({
      id,
      tenant_id: tenant,
      mailbox_id: mailbox,
      created_by: user,
      filename: 'source.eml',
      format: 'eml',
      size_bytes: String(raw.length),
      storage_path: path,
      state: 'queued',
    })
    .execute();
  await registerSecurityFile(db, {
    storage_key: path,
    tenant_id: tenant,
    mailbox_id: mailbox,
    resource_id: id,
    filename: 'source.eml',
    content_type: 'message/rfc822',
    size_bytes: raw.length,
    kind: 'mail_import',
  });
  await handleMailArchive(r, id, 'import-' + id);
  const task = await db
    .selectFrom('mail_archive_imports')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  expect(task.state).toBe('completed');
  expect(task.imported).toBe(1);
  expect(await r.storage.inspect(path)).not.toBe(null);
  expect(task.storage_path).toBe(path);
  const message = await db
    .selectFrom('messages')
    .select('id')
    .where('message_id_header', '=', `<${id}@example.test>`)
    .executeTakeFirstOrThrow();
  expect(
    await db
      .selectFrom('file_security')
      .select(['kind', 'status'])
      .where('message_id', '=', message.id)
      .executeTakeFirstOrThrow(),
  ).toMatchObject({ kind: 'mail_raw', status: 'pending' });
});
it('recria agendamento apagado e recupera fila pelos registros pendentes persistentes', async () => {
  await r.queues['antivirus-scan'].removeJobScheduler('antivirus-sweep');
  await ensureAntivirusScheduler(r);
  expect(await r.queues['antivirus-scan'].getJobScheduler('antivirus-sweep')).toBeDefined();
  const pending = await db
    .selectFrom('file_security')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .where('status', '=', 'pending')
    .execute();
  expect(pending.length).toBeGreaterThan(0);
  await db
    .updateTable('file_security')
    .set({ next_attempt_at: new Date('1999-01-01T00:00:00Z') })
    .where(
      'id',
      'in',
      pending.map((file) => file.id),
    )
    .execute();
  await sweepSecurityFiles(db, r.queues['antivirus-scan']);
  const jobs = await r.queues['antivirus-scan'].getJobs(['waiting', 'delayed']);
  expect(pending.every((file) => jobs.some((job) => job.data.id === file.id))).toBe(true);
});
