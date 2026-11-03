import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { createDb, createQueues, Storage, asJson } from '@apmail/db';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import pino from 'pino';
import { handleFolderAction } from '../../src/handlers/folder-actions.js';
import { envSchema } from '../../src/env.js';
import type { WorkerResources } from '../../src/resources.js';
const remote = vi.hoisted(() => ({ paths: new Set<string>(), rename: vi.fn() }));
vi.mock('../../src/imap/connect.js', () => ({
  transports: async () => ({
    imap: {
      connect: async () => {},
      list: async () => [...remote.paths].map((path) => ({ path })),
      mailboxRename: async (from: string, to: string) => {
        remote.rename(from, to);
        remote.paths = new Set(
          [...remote.paths].map((path) =>
            path === from || path.startsWith(from + '.') ? to + path.slice(from.length) : path,
          ),
        );
      },
    },
    close: async () => {},
  }),
}));
vi.mock('../../src/imap/sync-folders.js', () => ({ syncFolders: async () => {} }));
const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test') || !redisUrl)
  throw Error('Dedicated QA database required');
const db = createDb(url),
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null }),
  queues = createQueues(redisUrl);
const tenant = randomUUID(),
  user = randomUUID();
const r: WorkerResources = {
  db,
  redis,
  queues: queues.queues,
  io: new Emitter(redis),
  log: pino({ level: 'silent' }),
  storage: new Storage(tmpdir(), db),
  env: envSchema.parse({
    DATABASE_URL: url,
    REDIS_URL: redisUrl,
    APP_URL: 'http://localhost:5173',
    SESSION_SECRET: Buffer.alloc(32).toString('base64'),
    CREDENTIALS_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
  }),
};
beforeAll(async () => {
  await db
    .insertInto('tenants')
    .values({ id: tenant, name: 'Relocation QA', slug: 'relocation-' + tenant })
    .execute();
  await db
    .insertInto('users')
    .values({ id: user, email: user + '@test.invalid', full_name: 'QA', password_hash: 'fixture' })
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
});
async function fixture(imap = false) {
  const box = randomUUID(),
    source = randomUUID(),
    child = randomUUID(),
    target = randomUUID();
  await db
    .insertInto('mailboxes')
    .values({
      id: box,
      tenant_id: tenant,
      name: 'QA',
      email_address: box + '@test.invalid',
      username: 'qa',
      imap_host: 'unused',
      smtp_host: 'unused',
      receiving_protocol: imap ? 'imap' : 'local',
      status: 'active',
    })
    .execute();
  await db
    .insertInto('folders')
    .values([
      {
        id: source,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'A',
        imap_path: 'A',
        is_local: !imap,
        delimiter: '.',
      },
      {
        id: child,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'B',
        imap_path: 'A.B',
        parent_id: source,
        is_local: !imap,
        delimiter: '.',
      },
      {
        id: target,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'Z',
        imap_path: 'Z',
        is_local: !imap,
        delimiter: '.',
      },
    ])
    .execute();
  const thread = randomUUID(),
    message = randomUUID();
  await db
    .insertInto('threads')
    .values({ id: thread, tenant_id: tenant, mailbox_id: box, subject: 'Preserve' })
    .execute();
  await db
    .insertInto('messages')
    .values({
      id: message,
      tenant_id: tenant,
      mailbox_id: box,
      thread_id: thread,
      folder_id: child,
      message_id_header: message + '@test.invalid',
      subject: 'Preserve',
      from_address: 'a@test.invalid',
      direction: 'inbound',
      message_at: new Date(),
    })
    .execute();
  const action = await db
    .insertInto('mail_actions')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      requested_by: user,
      type: 'rename_folder',
      payload: asJson({
        folder_id: source,
        name: 'A',
        parent_id: target,
        source_path: 'A',
        imap_path: 'Z.A',
      }),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { box, source, child, target, message, action };
}
it('local move preserves IDs/messages, updates subtree and root parent, and repeats safely', async () => {
  const f = await fixture();
  await handleFolderAction(r, f.action, randomUUID(), true);
  expect(
    await db
      .selectFrom('folders')
      .select(['imap_path', 'parent_id'])
      .where('id', '=', f.source)
      .executeTakeFirstOrThrow(),
  ).toEqual({ imap_path: 'Z.A', parent_id: f.target });
  expect(
    await db
      .selectFrom('folders')
      .select(['imap_path', 'parent_id'])
      .where('id', '=', f.child)
      .executeTakeFirstOrThrow(),
  ).toEqual({ imap_path: 'Z.A.B', parent_id: f.source });
  expect(
    (
      await db
        .selectFrom('messages')
        .select('folder_id')
        .where('id', '=', f.message)
        .executeTakeFirstOrThrow()
    ).folder_id,
  ).toBe(f.child);
  await db
    .updateTable('mail_actions')
    .set({ status: 'processing' })
    .where('id', '=', f.action.id)
    .execute();
  await handleFolderAction(r, f.action, randomUUID(), true);
  expect(
    (
      await db
        .selectFrom('folders')
        .select('imap_path')
        .where('id', '=', f.child)
        .executeTakeFirstOrThrow()
    ).imap_path,
  ).toBe('Z.A.B');
});
it('renames an imported local subtree below its existing remote parent without contacting IMAP', async () => {
  const f = await fixture(true),
    prefix = 'local/folders/' + f.target + '/';
  await db
    .updateTable('folders')
    .set({ is_local: true, delimiter: '/', parent_id: f.target, imap_path: prefix + 'A' })
    .where('id', '=', f.source)
    .execute();
  await db
    .updateTable('folders')
    .set({ is_local: true, delimiter: '/', imap_path: prefix + 'A/B' })
    .where('id', '=', f.child)
    .execute();
  await db
    .updateTable('mail_actions')
    .set({
      payload: asJson({
        folder_id: f.source,
        name: 'Renamed',
        parent_id: f.target,
        source_path: prefix + 'A',
        imap_path: prefix + 'Renamed',
      }),
    })
    .where('id', '=', f.action.id)
    .execute();
  remote.rename.mockClear();
  await handleFolderAction(r, f.action, randomUUID(), true);
  expect(remote.rename).not.toHaveBeenCalled();
  expect(
    await db
      .selectFrom('folders')
      .select(['name', 'imap_path', 'parent_id'])
      .where('id', '=', f.source)
      .executeTakeFirstOrThrow(),
  ).toEqual({ name: 'Renamed', imap_path: prefix + 'Renamed', parent_id: f.target });
  expect(
    (
      await db
        .selectFrom('folders')
        .select('imap_path')
        .where('id', '=', f.child)
        .executeTakeFirstOrThrow()
    ).imap_path,
  ).toBe(prefix + 'Renamed/B');
  expect(
    (
      await db
        .selectFrom('messages')
        .select('folder_id')
        .where('id', '=', f.message)
        .executeTakeFirstOrThrow()
    ).folder_id,
  ).toBe(f.child);
});
it('worker rejects stale queued destinations/cycles before applying', async () => {
  const f = await fixture();
  await db
    .updateTable('folders')
    .set({ parent_id: f.child, imap_path: 'A.B.Z' })
    .where('id', '=', f.target)
    .execute();
  await expect(handleFolderAction(r, f.action, randomUUID(), true)).rejects.toThrow();
  expect(
    (
      await db
        .selectFrom('folders')
        .select('imap_path')
        .where('id', '=', f.source)
        .executeTakeFirstOrThrow()
    ).imap_path,
  ).toBe('A');
});
it('worker rechecks permission after enqueue and leaves the folders unchanged on revocation', async () => {
  const f = await fixture(),
    denied = randomUUID();
  await db
    .insertInto('users')
    .values({
      id: denied,
      email: denied + '@test.invalid',
      full_name: 'Denied QA',
      password_hash: 'fixture',
    })
    .execute();
  await db
    .insertInto('tenant_members')
    .values({ tenant_id: tenant, user_id: denied, role: 'member' })
    .execute();
  await db
    .insertInto('mailbox_members')
    .values({ tenant_id: tenant, mailbox_id: f.box, user_id: denied, role: 'viewer' })
    .execute();
  await db
    .updateTable('mail_actions')
    .set({ requested_by: denied })
    .where('id', '=', f.action.id)
    .execute();
  await expect(handleFolderAction(r, f.action, randomUUID(), true)).rejects.toThrow(/permissão/);
  expect(
    (
      await db
        .selectFrom('folders')
        .select('imap_path')
        .where('id', '=', f.source)
        .executeTakeFirstOrThrow()
    ).imap_path,
  ).toBe('A');
  expect(
    (
      await db
        .selectFrom('mail_actions')
        .select('status')
        .where('id', '=', f.action.id)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('failed');
});
it('IMAP moves a subtree once and rejects preexisting remote destination without touching SQL', async () => {
  const f = await fixture(true);
  remote.paths = new Set(['A', 'A.B', 'Z']);
  remote.rename.mockClear();
  await handleFolderAction(r, f.action, randomUUID(), true);
  expect(remote.rename).toHaveBeenCalledExactlyOnceWith('A', 'Z.A');
  expect(remote.paths).toEqual(new Set(['Z.A', 'Z.A.B', 'Z']));
  const conflict = await fixture(true);
  remote.paths = new Set(['A', 'A.B', 'Z', 'Z.A']);
  remote.rename.mockClear();
  await expect(handleFolderAction(r, conflict.action, randomUUID(), true)).rejects.toThrow(
    /existe/,
  );
  expect(remote.rename).not.toHaveBeenCalled();
  expect(
    (
      await db
        .selectFrom('folders')
        .select('imap_path')
        .where('id', '=', conflict.source)
        .executeTakeFirstOrThrow()
    ).imap_path,
  ).toBe('A');
});
it('IMAP crash recovery reuses renamed remote path without changing IDs or renaming twice', async () => {
  const f = await fixture(true);
  remote.paths = new Set(['Z', 'Z.A', 'Z.A.B']);
  remote.rename.mockClear();
  await handleFolderAction(r, f.action, randomUUID(), true);
  expect(remote.rename).not.toHaveBeenCalled();
  expect(
    await db
      .selectFrom('folders')
      .select(['imap_path', 'parent_id'])
      .where('id', '=', f.source)
      .executeTakeFirstOrThrow(),
  ).toEqual({ imap_path: 'Z.A', parent_id: f.target });
  expect(
    (
      await db
        .selectFrom('folders')
        .select('imap_path')
        .where('id', '=', f.child)
        .executeTakeFirstOrThrow()
    ).imap_path,
  ).toBe('Z.A.B');
});
