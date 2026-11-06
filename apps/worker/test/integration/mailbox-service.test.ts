import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import pino from 'pino';
import { createDb, createQueues, migrate, ensureLocalFolders, Storage, type DB } from '@apmail/db';
import { socketRedisKey } from '@apmail/shared';
import type { Selectable } from 'kysely';
import { envSchema } from '../../src/env.js';
import { ingestMessage } from '../../src/imap/ingest-message.js';
const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (
  !url ||
  !new URL(url).pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
)
  throw Error('Dedicated local test database required');
if (
  !redisUrl ||
  !['localhost', '127.0.0.1'].includes(new URL(redisUrl).hostname) ||
  new URL(redisUrl).pathname !== '/9'
)
  throw Error('Dedicated local Redis /9 required');
const db = createDb(url),
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null }),
  queues = createQueues(redisUrl);
const tenant = randomUUID(),
  owner = randomUUID(),
  boxId = randomUUID(),
  key = randomBytes(32).toString('base64');
const storagePath = join(tmpdir(), 'apmail-service-' + tenant);
const r = {
  db,
  redis,
  queues: queues.queues,
  storage: new Storage(storagePath, db),
  log: pino({ level: 'silent' }),
  io: new Emitter(redis, { key: socketRedisKey(redisUrl) }),
  env: envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redisUrl,
    APP_URL: 'http://localhost:5173',
    SESSION_SECRET: key,
    CREDENTIALS_ENCRYPTION_KEY: key,
    STORAGE_DIR: storagePath,
  }),
};
let box: Selectable<DB['mailboxes']>,
  inbox: Selectable<DB['folders']>,
  uid = 0;
beforeAll(async () => {
  await migrate(url);
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('tenants')
      .values({ id: tenant, name: 'Ingest service QA', slug: tenant })
      .execute();
    await tx
      .insertInto('users')
      .values({
        id: owner,
        email: owner + '@ingest.test',
        full_name: 'QA',
        password_hash: 'fixture',
      })
      .execute();
    await tx.insertInto('tenant_members').values({ tenant_id: tenant, user_id: owner }).execute();
    box = await tx
      .insertInto('mailboxes')
      .values({
        id: boxId,
        tenant_id: tenant,
        name: 'Individual',
        email_address: 'inbound@ingest.test',
        username: 'qa',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        box_type: 'individual',
        owner_user_id: owner,
        queues_enabled: false,
        import_started_at: new Date('2026-01-01'),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await tx
      .insertInto('mailbox_members')
      .values({ tenant_id: tenant, mailbox_id: boxId, user_id: owner, role: 'editor' })
      .execute();
    inbox = await ensureLocalFolders(tx, tenant, boxId);
  });
});
afterAll(async () => {
  await queues.close();
  await redis.quit();
  await db.destroy();
});
async function incoming(
  options: {
    kind?: 'archive' | 'pop3';
    historical?: boolean;
    header?: string;
    extra?: string;
    internalDate?: Date;
  } = {},
) {
  const header = options.header ?? '<' + randomUUID() + '@ingest.test>';
  const raw = Buffer.from(
    'From: Customer <customer@ingest.test>\r\nTo: inbound@ingest.test\r\nMessage-ID: ' +
      header +
      '\r\nDate: Fri, 06 Nov 2026 12:00:00 GMT\r\nSubject: Service ' +
      header +
      '\r\n' +
      (options.extra ?? '') +
      'Content-Type: text/plain; charset=utf-8\r\n\r\nRequest\r\n',
  );
  const id = ++uid;
  const thread = await ingestMessage(
    r,
    box,
    inbox,
    {
      uid: id,
      seq: id,
      source: raw,
      size: raw.length,
      flags: new Set(),
      internalDate: options.internalDate ?? new Date('2026-11-06T12:00:00Z'),
    },
    options.kind
      ? { kind: options.kind, historical: options.historical ?? false, key: tenant + '-' + id }
      : undefined,
  );
  return db.selectFrom('threads').selectAll().where('id', '=', thread).executeTakeFirstOrThrow();
}
it('new live IMAP and POP inbound assign only the owner without starting service even with queues hidden', async () => {
  for (const kind of [undefined, 'pop3'] as const) {
    const thread = await incoming({ kind });
    expect(thread.assigned_to).toBe(owner);
    expect(thread.service_started_at).toBeNull();
    expect(thread.queue_status).toBe('to_reply');
  }
});
it('old IMAP history and archive imports keep existing assignments untouched', async () => {
  for (const options of [
    { internalDate: new Date('2025-12-01') },
    { kind: 'archive' as const, historical: false },
    { kind: 'pop3' as const, historical: true },
  ]) {
    const thread = await incoming(options);
    expect(thread.assigned_to).toBeNull();
    expect(thread.service_started_at).toBeNull();
  }
});
it('automated messages and second-folder copies do not retroactively claim service ownership', async () => {
  expect((await incoming({ extra: 'Auto-Submitted: auto-generated\r\n' })).assigned_to).toBeNull();
  const header = '<' + randomUUID() + '@ingest.test>',
    first = await incoming({ header });
  await db
    .updateTable('threads')
    .set({ assigned_to: null, assigned_at: null })
    .where('id', '=', first.id)
    .execute();
  const copy = await incoming({ header });
  expect(copy.id).toBe(first.id);
  expect(copy.assigned_to).toBeNull();
});
