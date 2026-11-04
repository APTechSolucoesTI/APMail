import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, createQueues, Storage, asJson, migrate } from '@apmail/db';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import pino from 'pino';
import { envSchema } from '../../src/env.js';
import { handleMailboxTransfer } from '../../src/handlers/mail-transfer.js';
import { queueMailboxTransfer } from '../../../api/src/modules/mail-transfer.js';
import type { WorkerResources } from '../../src/resources.js';
import type { Resources } from '../../../api/src/modules/resources.js';
import type { RequestContext } from '../../../api/src/authz/context.js';

const remote = vi.hoisted(() => ({
  append: vi.fn(),
  remove: vi.fn(),
  headerFound: false,
  failAppend: false,
  failDelete: false,
  validity: 100n,
  messageHeader: '<qa@test>',
}));
vi.mock('../../src/imap/connect.js', () => ({
  transports: async (_db: unknown, box: { id: string }) => ({
    imap: {
      get mailbox() {
        return { uidValidity: remote.validity };
      },
      connect: async () => {},
      getMailboxLock: async () => ({ release() {} }),
      search: async (query: { header?: unknown }) =>
        query.header ? (remote.headerFound ? [77] : []) : [41],
      append: async () => {
        remote.append(box.id);
        if (remote.failAppend) throw new Error('temporary destination failure');
        remote.headerFound = true;
        return { uid: 77 };
      },
      messageDelete: async () => {
        if (remote.failDelete) {
          remote.failDelete = false;
          throw new Error('temporary source failure');
        }
        remote.remove(box.id);
      },
      fetchOne: async () => ({
        envelope: { messageId: remote.messageHeader },
        source: Buffer.from(
          'From: Sender <from@example.test>\r\nTo: target@example.test\r\nSubject: Preserved\r\nMessage-ID: ' +
            remote.messageHeader +
            '\r\n\r\nOriginal raw body',
        ),
      }),
    },
    close: async () => {},
  }),
}));
const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test') || !redisUrl)
  throw Error('Dedicated QA database required');
const db = createDb(url),
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null }),
  queues = createQueues(redisUrl),
  tenant = randomUUID(),
  user = randomUUID();
let directory: string;
const r: WorkerResources = {
  db,
  redis,
  queues: queues.queues,
  io: new Emitter(redis),
  log: pino({ level: 'silent' }),
  storage: new Storage(tmpdir(), db),
  env: envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redisUrl,
    APP_URL: 'http://localhost:5173',
    SESSION_SECRET: Buffer.alloc(32).toString('base64'),
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  }),
};
const context = (): RequestContext => ({
  userId: user,
  tenantId: tenant,
  tenantRole: 'owner',
  requestId: randomUUID(),
  ip: '127.0.0.1',
  sessionHash: 'qa',
  mailboxRoles: new Map(),
});
const apiResources = { ...r, io: r.io } as unknown as Resources;
beforeAll(async () => {
  await migrate(url);
  directory = await mkdtemp(join(tmpdir(), 'apmail-transfer-'));
  r.storage = new Storage(directory, db);
  await db
    .insertInto('tenants')
    .values({ id: tenant, name: 'Transfer QA', slug: 'transfer-' + tenant })
    .execute();
  await db
    .insertInto('users')
    .values({ id: user, email: user + '@transfer.test', full_name: 'QA', password_hash: 'fixture' })
    .execute();
  await db
    .insertInto('tenant_members')
    .values({ tenant_id: tenant, user_id: user, role: 'owner' })
    .execute();
});
afterAll(async () => {
  await queues.close();
  await redis.quit();
  await db.destroy();
  await rm(directory, { recursive: true, force: true });
});
async function fixture(remoteTarget = false) {
  remote.append.mockClear();
  remote.remove.mockClear();
  remote.headerFound = false;
  remote.failAppend = false;
  remote.failDelete = false;
  remote.validity = 100n;
  const source = randomUUID(),
    target = randomUUID(),
    from = randomUUID(),
    to = randomUUID(),
    thread = randomUUID(),
    message = randomUUID(),
    attachment = randomUUID();
  for (const [id, isRemote] of [
    [source, false],
    [target, remoteTarget],
  ] as const)
    await db
      .insertInto('mailboxes')
      .values({
        id,
        tenant_id: tenant,
        name: 'QA',
        email_address: id + '@transfer.test',
        imap_host: 'unused',
        smtp_host: 'unused',
        username: 'qa',
        receiving_protocol: isRemote ? 'imap' : 'local',
        status: 'active',
      })
      .execute();
  await db
    .insertInto('folders')
    .values([
      {
        id: from,
        tenant_id: tenant,
        mailbox_id: source,
        name: 'Source',
        imap_path: 'Source',
        is_local: true,
      },
      {
        id: to,
        tenant_id: tenant,
        mailbox_id: target,
        name: 'Target',
        imap_path: 'Target',
        is_local: !remoteTarget,
      },
    ])
    .execute();
  await db
    .insertInto('threads')
    .values({
      id: thread,
      tenant_id: tenant,
      mailbox_id: source,
      subject: 'Preserved',
      subject_normalized: 'preserved',
    })
    .execute();
  await db
    .insertInto('messages')
    .values({
      id: message,
      tenant_id: tenant,
      mailbox_id: source,
      folder_id: from,
      thread_id: thread,
      direction: 'outbound',
      sent_by_user_id: user,
      message_id_header: '<' + message + '@transfer.test>',
      message_at: new Date(),
      from_address: 'from@example.test',
      to_addresses: asJson([{ address: 'client@example.test', name: 'Cliente' }]),
      subject: 'Preserved',
      body_text: 'Original body',
      body_html: '<p>Original body</p>',
      has_attachments: true,
      source_kind: 'archive',
    })
    .execute();
  const path = `attachments/${tenant}/${source}/${message}/${attachment}`;
  await r.storage.writeFile(path, Buffer.from('Exact attachment bytes'));
  await db
    .insertInto('attachments')
    .values({
      id: attachment,
      tenant_id: tenant,
      mailbox_id: source,
      message_id: message,
      filename: 'document.txt',
      content_type: 'text/plain',
      size_bytes: 22,
      storage_path: path,
    })
    .execute();
  await db
    .insertInto('file_security')
    .values({
      storage_key: path,
      tenant_id: tenant,
      mailbox_id: source,
      message_id: message,
      resource_id: attachment,
      filename: 'document.txt',
      content_type: 'text/plain',
      kind: 'attachment',
      status: 'clean',
      size_bytes: String(Buffer.byteLength('Exact attachment bytes')),
      sha256: createHash('sha256').update('Exact attachment bytes').digest('hex'),
      scanned_at: new Date(),
    })
    .execute();
  return { source, target, from, to, thread, message };
}
async function enqueue(f: Awaited<ReturnType<typeof fixture>>) {
  const result = await queueMailboxTransfer(
    apiResources,
    context(),
    f.source,
    { message_ids: [f.message], target_mailbox_id: f.target, target_folder_id: f.to },
    randomUUID(),
  );
  return db
    .selectFrom('mail_actions')
    .selectAll()
    .where('id', '=', result.action_id)
    .executeTakeFirstOrThrow();
}
it('moves between local mailboxes preserving body, addresses and attachment bytes, and is idempotent', async () => {
  const f = await fixture(),
    action = await enqueue(f);
  expect(
    (
      await db
        .selectFrom('messages')
        .selectAll()
        .where('id', '=', f.message)
        .executeTakeFirstOrThrow()
    ).deleted_at,
  ).toBeNull();
  await handleMailboxTransfer(r, action, 'qa-' + action.id, false);
  await handleMailboxTransfer(r, action, 'qa-repeat-' + action.id, false);
  const copies = await db
    .selectFrom('messages')
    .selectAll()
    .where('mailbox_id', '=', f.target)
    .execute();
  expect(copies).toHaveLength(1);
  expect(copies[0]).toMatchObject({
    body_text: 'Original body',
    subject: 'Preserved',
    pending_action: false,
    sent_by_user_id: user,
    folder_id: f.to,
  });
  expect(
    (
      await db
        .selectFrom('messages')
        .selectAll()
        .where('id', '=', f.message)
        .executeTakeFirstOrThrow()
    ).deleted_at,
  ).not.toBeNull();
  const a = await db
    .selectFrom('attachments')
    .selectAll()
    .where('message_id', '=', copies[0]!.id)
    .executeTakeFirstOrThrow();
  const chunks: Buffer[] = [];
  for await (const part of await r.storage.openReadStream(a.storage_path))
    chunks.push(Buffer.from(part));
  expect(Buffer.concat(chunks)).toEqual(Buffer.from('Exact attachment bytes'));
});
it('rechecks destination marker after an interruption before deleting an IMAP source', async () => {
  const f = await fixture(true);
  remote.messageHeader = '<' + f.message + '@transfer.test>';
  await db
    .updateTable('mailboxes')
    .set({ receiving_protocol: 'imap' })
    .where('id', '=', f.source)
    .execute();
  await db
    .updateTable('folders')
    .set({ is_local: false, uidvalidity: '100' })
    .where('id', '=', f.from)
    .execute();
  await db
    .updateTable('messages')
    .set({ source_kind: 'imap', imap_uid: '41' })
    .where('id', '=', f.message)
    .execute();
  const action = await enqueue(f);
  remote.failDelete = true;
  await expect(
    handleMailboxTransfer(r, action, 'qa-interrupt-' + action.id, false),
  ).rejects.toThrow('temporary source failure');
  expect(remote.append).toHaveBeenCalledTimes(1);
  expect(remote.remove).not.toHaveBeenCalled();
  await handleMailboxTransfer(r, action, 'qa-resume-' + action.id, false);
  expect(remote.append).toHaveBeenCalledTimes(1);
  expect(remote.remove).toHaveBeenCalledWith(f.source);
});
it('does not fetch or delete a reused source UID after UIDVALIDITY changes', async () => {
  const f = await fixture(true);
  remote.messageHeader = '<' + f.message + '@transfer.test>';
  await db
    .updateTable('mailboxes')
    .set({ receiving_protocol: 'imap' })
    .where('id', '=', f.source)
    .execute();
  await db
    .updateTable('folders')
    .set({ is_local: false, uidvalidity: '99' })
    .where('id', '=', f.from)
    .execute();
  await db
    .updateTable('messages')
    .set({ source_kind: 'imap', imap_uid: '41' })
    .where('id', '=', f.message)
    .execute();
  const action = await enqueue(f);
  await expect(handleMailboxTransfer(r, action, 'qa-uid-' + action.id, true)).rejects.toThrow(
    'pasta de origem mudou',
  );
  expect(remote.remove).not.toHaveBeenCalled();
  expect(remote.append).not.toHaveBeenCalled();
  expect(
    (
      await db
        .selectFrom('messages')
        .select('deleted_at')
        .where('id', '=', f.message)
        .executeTakeFirstOrThrow()
    ).deleted_at,
  ).toBeNull();
});
it('retains source when destination append fails, then resumes the same copy without duplicates', async () => {
  const f = await fixture(true),
    action = await enqueue(f);
  remote.failAppend = true;
  await expect(handleMailboxTransfer(r, action, 'qa-' + action.id, false)).rejects.toThrow();
  expect(
    (
      await db
        .selectFrom('messages')
        .select('deleted_at')
        .where('id', '=', f.message)
        .executeTakeFirstOrThrow()
    ).deleted_at,
  ).toBeNull();
  expect(remote.remove).not.toHaveBeenCalled();
  remote.failAppend = false;
  await handleMailboxTransfer(r, action, 'qa-resume-' + action.id, false);
  expect(
    await db.selectFrom('messages').select('id').where('mailbox_id', '=', f.target).execute(),
  ).toHaveLength(1);
  expect(
    (
      await db
        .selectFrom('messages')
        .select('deleted_at')
        .where('id', '=', f.message)
        .executeTakeFirstOrThrow()
    ).deleted_at,
  ).not.toBeNull();
});
it('rejects inaccessible targets and rechecks revoked destination permissions before processing', async () => {
  const f = await fixture();
  await expect(
    queueMailboxTransfer(
      apiResources,
      context(),
      f.source,
      { message_ids: [f.message], target_mailbox_id: randomUUID(), target_folder_id: f.to },
      randomUUID(),
    ),
  ).rejects.toThrow();
  const action = await enqueue(f);
  await db
    .insertInto('users')
    .values({
      id: randomUUID(),
      email: randomUUID() + '@qa.test',
      full_name: 'Other',
      password_hash: 'fixture',
    })
    .execute();
  await db
    .updateTable('mailboxes')
    .set({ status: 'disabled' })
    .where('id', '=', f.target)
    .execute();
  await expect(handleMailboxTransfer(r, action, 'qa-denied-' + action.id, true)).rejects.toThrow();
  expect(
    await db
      .selectFrom('messages')
      .select(['deleted_at', 'pending_action'])
      .where('id', '=', f.message)
      .executeTakeFirstOrThrow(),
  ).toEqual({ deleted_at: null, pending_action: false });
});
