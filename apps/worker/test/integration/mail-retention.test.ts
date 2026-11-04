import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import pino from 'pino';
import {
  createDb,
  createQueues,
  ensureLocalFolders,
  migrate,
  Storage,
  touchThreads,
} from '@apmail/db';
import { socketRedisKey } from '@apmail/shared';
import { buildApp } from '../../../api/src/app.js';
import { envSchema as apiEnv } from '../../../api/src/env.js';
import { hashToken } from '../../../api/src/plugins/auth.js';
import { envSchema } from '../../src/env.js';
import { handleMailAction } from '../../src/handlers/mail-actions.js';
import { purgeRetainedMail } from '../../src/handlers/mail-retention.js';
import { ingestMessage } from '../../src/imap/ingest-message.js';
import { transports } from '../../src/imap/connect.js';

vi.mock('../../src/imap/connect.js', () => ({ transports: vi.fn() }));

const url = process.env.DATABASE_URL_TEST!;
const redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test') || new URL(url).hostname !== '127.0.0.1')
  throw new Error('Banco local de testes obrigatório.');
const tenant = randomUUID(),
  foreignTenant = randomUUID(),
  admin = randomUUID();
const member = randomUUID(),
  foreign = randomUUID(),
  box = randomUUID();
const origin = 'http://localhost:5173';
const secret = randomBytes(32).toString('base64');
const config = {
  NODE_ENV: 'test',
  DATABASE_URL: url,
  REDIS_URL: redisUrl,
  APP_URL: origin,
  SESSION_SECRET: secret,
  CREDENTIALS_ENCRYPTION_KEY: secret,
  STORAGE_DIR: join(tmpdir(), 'apmail-retention-' + tenant),
};
const db = createDb(url);
const app = await buildApp(apiEnv.parse(config));
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const queues = createQueues(redisUrl);
const r = {
  db,
  redis,
  queues: queues.queues,
  env: envSchema.parse(config),
  storage: new Storage(config.STORAGE_DIR, db),
  log: pino({ level: 'silent' }),
  io: new Emitter(redis, { key: socketRedisKey(redisUrl) }),
};
const cookies = new Map<string, string>();
const call = (method: 'GET' | 'PATCH' | 'POST', path: string, payload?: object, user = admin) =>
  app.inject({
    method,
    url: '/api' + path,
    headers: { origin, cookie: cookies.get(user)! },
    payload,
  });
let inbox = '',
  trash = '';

beforeAll(async () => {
  await migrate(url);
  await app.ready();
  for (const id of [tenant, foreignTenant])
    await db
      .insertInto('tenants')
      .values({ id, name: 'Retenção QA', slug: 'retention-' + id })
      .execute();
  for (const [id, company, role] of [
    [admin, tenant, 'owner'],
    [member, tenant, 'member'],
    [foreign, foreignTenant, 'owner'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@retention.test',
        full_name: 'Pessoa ' + role,
        password_hash: 'fixture',
        current_tenant_id: company,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: company, user_id: id, role })
      .execute();
    const token = randomBytes(32).toString('base64url');
    await db
      .insertInto('sessions')
      .values({
        user_id: id,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 3600_000),
      })
      .execute();
    cookies.set(id, 'apmail_session=' + encodeURIComponent(app.signCookie(token)));
  }
  await db
    .insertInto('mailboxes')
    .values({
      id: box,
      tenant_id: tenant,
      name: 'Caixa QA',
      email_address: box + '@retention.test',
      username: 'qa',
      imap_host: 'local',
      smtp_host: 'local',
      receiving_protocol: 'local',
      status: 'active',
    })
    .execute();
  await db
    .insertInto('mailbox_members')
    .values({ tenant_id: tenant, mailbox_id: box, user_id: member, role: 'mailbox_admin' })
    .execute();
  await ensureLocalFolders(db, tenant, box);
  const folders = await db
    .selectFrom('folders')
    .select(['id', 'special_use'])
    .where('mailbox_id', '=', box)
    .execute();
  inbox = folders.find((folder) => folder.special_use === 'inbox')!.id;
  trash = folders.find((folder) => folder.special_use === 'trash')!.id;
});
afterAll(async () => {
  await queues.close();
  await redis.quit();
  await app.close();
  await db.destroy();
});

async function seed(folder: string, subject: string, storagePath?: string) {
  const thread = randomUUID(),
    id = randomUUID();
  await db
    .insertInto('threads')
    .values({
      id: thread,
      tenant_id: tenant,
      mailbox_id: box,
      subject,
      subject_normalized: subject,
    })
    .execute();
  await db
    .insertInto('messages')
    .values({
      id,
      tenant_id: tenant,
      mailbox_id: box,
      folder_id: folder,
      thread_id: thread,
      message_id_header: '<' + id + '@retention.test>',
      subject,
      direction: 'inbound',
      message_at: new Date(),
      body_text: 'Conteúdo retido da mensagem QA',
      source_kind: 'archive',
      has_attachments: !!storagePath,
    })
    .execute();
  if (storagePath)
    await db
      .insertInto('attachments')
      .values({
        tenant_id: tenant,
        mailbox_id: box,
        message_id: id,
        filename: 'teste.txt',
        storage_path: storagePath,
        size_bytes: 4,
      })
      .execute();
  await touchThreads(db, [thread], 'sync', null);
  return { id, thread };
}

it('preserva e restaura o conteúdo, calcula o prazo na lixeira e purga com isolamento e confirmação', async () => {
  const sharedPath = 'attachments/' + tenant + '/' + box + '/' + randomUUID() + '/teste.txt';
  await r.storage.writeFile(sharedPath, Buffer.from('teste'));
  const first = await seed(inbox, 'Proposta em retenção', sharedPath);
  const second = await seed(trash, 'Outra mensagem', sharedPath);
  const move = await call(
    'POST',
    '/mailboxes/' + box + '/messages/actions',
    { type: 'delete', message_ids: [first.id] },
    member,
  );
  expect(move.statusCode, move.body).toBe(202);
  await handleMailAction(r, move.json().action_id, randomUUID(), true);
  const message = (id: string) =>
    db.selectFrom('messages').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  expect((await message(first.id)).folder_id).toBe(trash);
  expect((await message(first.id)).retention_expires_at).toBeNull();

  expect((await call('PATCH', '/mail-retention/policy', { days: 7 })).statusCode).toBe(200);
  const empty = await call(
    'POST',
    '/mailboxes/' + box + '/messages/actions',
    { type: 'delete', trash_folder_id: trash },
    member,
  );
  expect(empty.statusCode, empty.body).toBe(202);
  expect(empty.json().affected).toBe(2);
  await handleMailAction(r, empty.json().action_id, randomUUID(), true);
  const retained = await message(first.id);
  expect(retained.pending_action).toBe(false);
  expect(retained.retention_deleted_by).toBe(member);
  expect(retained.retention_expires_at!.getTime() - retained.deleted_at!.getTime()).toBe(
    7 * 86_400_000,
  );
  expect((await call('GET', '/threads/' + first.thread, undefined, member)).statusCode).toBe(404);
  expect((await call('GET', '/mail-retention', undefined, member)).statusCode).toBe(403);
  expect((await call('GET', '/mail-retention/' + first.id, undefined, foreign)).statusCode).toBe(
    404,
  );
  expect(
    (
      await call('GET', '/mail-retention?q=Proposta&mailbox_id=' + box + '&user_id=' + member)
    ).json().total,
  ).toBe(1);
  expect((await call('GET', '/mail-retention/' + first.id)).json()).toMatchObject({
    body_text: 'Conteúdo retido da mensagem QA',
    attachments: [{ filename: 'teste.txt' }],
  });

  await call('PATCH', '/mail-retention/policy', { days: 1 });
  await purgeRetainedMail(r);
  expect((await message(first.id)).retention_expires_at).toEqual(retained.retention_expires_at);
  expect((await call('POST', '/mail-retention/' + first.id + '/restore')).statusCode).toBe(200);
  expect((await message(first.id)).folder_id).toBe(inbox);
  expect((await message(first.id)).deleted_at).toBeNull();
  expect(
    (
      await call('POST', '/mail-retention/purge', {
        scope: 'all',
        expected_count: 2,
        confirmation: 'EXCLUIR',
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await call('POST', '/mail-retention/purge', { scope: 'message', id: second.id })).statusCode,
  ).toBe(400);
  expect(
    (
      await call(
        'POST',
        '/mail-retention/purge',
        { scope: 'message', id: second.id, confirmation: 'EXCLUIR' },
        member,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await call(
        'POST',
        '/mail-retention/purge',
        { scope: 'message', id: second.id, confirmation: 'EXCLUIR' },
        foreign,
      )
    ).statusCode,
  ).toBe(404);

  const confirmed = await call('POST', '/mail-retention/purge', {
    scope: 'all',
    expected_count: 1,
    confirmation: 'EXCLUIR',
  });
  expect(confirmed.statusCode, confirmed.body).toBe(202);
  await purgeRetainedMail(r);
  expect((await message(second.id)).body_text).toBe('');
  expect((await message(second.id)).retention_expires_at).toBeNull();
  expect(await r.storage.inspect(sharedPath)).not.toBeNull();

  const next = await seed(trash, 'Limpeza automática');
  const remove = await call(
    'POST',
    '/mailboxes/' + box + '/messages/actions',
    { type: 'delete', message_ids: [next.id] },
    member,
  );
  expect(remove.statusCode, remove.body).toBe(202);
  await handleMailAction(r, remove.json().action_id, randomUUID(), true);
  await db
    .updateTable('messages')
    .set({ retention_expires_at: new Date(Date.now() - 1000) })
    .where('id', '=', next.id)
    .execute();
  await purgeRetainedMail(r);
  expect((await message(next.id)).body_text).toBe('');
  expect((await call('GET', '/mail-retention')).json().total).toBe(0);
});

it('persiste a cópia antes do EXPUNGE e bloqueia a reimportação IMAP depois da limpeza', async () => {
  const message = await seed(trash, 'Retenção IMAP QA');
  await db
    .updateTable('mailboxes')
    .set({ receiving_protocol: 'imap' })
    .where('id', '=', box)
    .execute();
  await db
    .updateTable('folders')
    .set({ is_local: false, uidvalidity: '777' })
    .where('id', '=', trash)
    .execute();
  await db
    .updateTable('messages')
    .set({ source_kind: 'imap', imap_uid: '42' })
    .where('id', '=', message.id)
    .execute();
  const expunge = vi.fn(async () => {
    const snapshot = await db
      .selectFrom('messages')
      .selectAll()
      .where('id', '=', message.id)
      .executeTakeFirstOrThrow();
    expect(snapshot.deleted_at).not.toBeNull();
    expect(snapshot.retention_expires_at).not.toBeNull();
    expect(snapshot.body_text).toBe('Conteúdo retido da mensagem QA');
    return true;
  });
  vi.mocked(transports).mockResolvedValue({
    imap: {
      connect: vi.fn(),
      getMailboxLock: async () => ({ release() {} }),
      mailbox: { uidValidity: 777n },
      capabilities: new Map([['UIDPLUS', true]]),
      enabled: new Set(),
      search: async () => [42],
      messageDelete: expunge,
    },
    close: vi.fn(),
  } as unknown as Awaited<ReturnType<typeof transports>>);
  const remove = await call(
    'POST',
    '/mailboxes/' + box + '/messages/actions',
    { type: 'delete', message_ids: [message.id] },
    member,
  );
  expect(remove.statusCode, remove.body).toBe(202);
  await handleMailAction(r, remove.json().action_id, randomUUID(), true);
  expect(expunge).toHaveBeenCalledWith([42], { uid: true });
  await db
    .updateTable('messages')
    .set({ retention_expires_at: new Date(Date.now() - 1000) })
    .where('id', '=', message.id)
    .execute();
  await purgeRetainedMail(r);
  const mailbox = await db
    .selectFrom('mailboxes')
    .selectAll()
    .where('id', '=', box)
    .executeTakeFirstOrThrow();
  const folder = await db
    .selectFrom('folders')
    .selectAll()
    .where('id', '=', trash)
    .executeTakeFirstOrThrow();
  expect(
    await ingestMessage(
      r,
      mailbox,
      { ...folder, uidvalidity: '778' },
      {
        seq: 1,
        uid: 55,
        envelope: {
          messageId: '<' + message.id + '@retention.test>',
          from: [{ address: 'qa@retention.test' }],
          subject: 'Retenção IMAP QA',
        },
      },
    ),
  ).toBe(message.thread);
  const resurrected = await db
    .selectFrom('messages')
    .select('id')
    .where('thread_id', '=', message.thread)
    .where('deleted_at', 'is', null)
    .execute();
  expect(resurrected).toEqual([]);
});
