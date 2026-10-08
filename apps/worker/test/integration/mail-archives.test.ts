import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { sql } from 'kysely';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import pino from 'pino';
import { createDb, migrate, Storage, createQueues } from '@apmail/db';
import { buildApp } from '../../../api/src/app.js';
import { envSchema as apiEnv } from '../../../api/src/env.js';
import { envSchema as workerEnv } from '../../src/env.js';
import { hashToken } from '../../../api/src/plugins/auth.js';
import { handleMailArchive } from '../../src/handlers/mail-archive.js';
import { readMailArchive } from '../../src/archives/read-mail-archive.js';
import { toMbox } from '../../../api/src/modules/mail-archive-exports.js';
import { createServer } from 'node:net';
import { writeMailboxCredential } from '@apmail/db';
import { handleMailboxSync } from '../../src/handlers/mailbox-sync.js';
import { handleMailAction } from '../../src/handlers/mail-actions.js';
import { syncFolders } from '../../src/imap/sync-folders.js';
import type { ImapFlow } from 'imapflow';
import type { WorkerResources } from '../../src/resources.js';
const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test') || !redisUrl)
  throw new Error('QA exclusivo obrigatório.');
const db = createDb(url),
  tenant = randomUUID(),
  foreignTenant = randomUUID(),
  owner = randomUUID(),
  member = randomUUID(),
  foreignOwner = randomUUID(),
  key = randomBytes(32).toString('base64'),
  origin = 'http://localhost:5173';
const dir = await mkdtemp(join(tmpdir(), 'apmail-mail-archive-'));
const env = {
  DATABASE_URL: url,
  REDIS_URL: redisUrl,
  APP_URL: origin,
  SESSION_SECRET: key,
  CREDENTIALS_ENCRYPTION_KEY: key,
  STORAGE_DIR: dir,
  NODE_ENV: 'test',
};
const app = await buildApp(apiEnv.parse(env));
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null }),
  resources = createQueues(redisUrl);
const r: WorkerResources = {
  db,
  redis: connection,
  queues: resources.queues,
  io: new Emitter(connection),
  log: pino({ level: 'silent' }),
  env: workerEnv.parse(env),
  storage: new Storage(dir, db),
};
const cookies = new Map<string, string>();
let box: string;
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  user = owner,
) =>
  app.inject({
    method,
    url: '/api' + path,
    headers: {
      origin,
      cookie: cookies.get(user) ?? '',
      ...(body !== undefined
        ? {
            'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json',
          }
        : {}),
    },
    ...(body !== undefined ? { payload: Buffer.isBuffer(body) ? body : JSON.stringify(body) } : {}),
  });
const mime = (id: string, body = 'Olá') =>
  Buffer.from(
    `From: Sender <sender@example.com>\r\nTo: qa@example.com\r\nDate: Wed, 07 Oct 2026 12:00:00 +0000\r\nMessage-ID: <${id}@qa.example>\r\nSubject: Backup ${id}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`,
  );
async function upload(raw: Buffer, filename = 'qa.eml', target = box) {
  const created = await call('POST', '/mailboxes/' + target + '/archive-imports', {
    filename,
    size_bytes: raw.length,
  });
  expect(created.statusCode, created.body).toBe(201);
  const task = created.json();
  const result = await call('POST', `/mailboxes/${target}/archive-imports/${task.id}/upload`, raw);
  expect(result.statusCode, result.body).toBe(200);
  return task.id as string;
}
async function state(id: string) {
  return db
    .selectFrom('mail_archive_imports')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
}
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Archive QA', slug: 'archive-' + tenant },
      { id: foreignTenant, name: 'Foreign Archive QA', slug: 'archive-' + foreignTenant },
    ])
    .execute();
  for (const [user, company, role] of [
    [owner, tenant, 'owner'],
    [member, tenant, 'member'],
    [foreignOwner, foreignTenant, 'owner'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id: user,
        email: user + '@qa.example',
        full_name: 'QA',
        password_hash: 'fixture',
        current_tenant_id: company,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: company, user_id: user, role })
      .execute();
    const token = randomBytes(32).toString('base64url');
    await db
      .insertInto('sessions')
      .values({
        user_id: user,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 3600000),
      })
      .execute();
    cookies.set(user, 'apmail_session=' + encodeURIComponent(app.signCookie(token)));
  }
  const result = await call('POST', '/mailboxes', {
    receiving_protocol: 'local',
    name: 'Backup QA',
    email_address: 'qa@example.com',
    history_classify_days: 0,
  });
  expect(result.statusCode, result.body).toBe(201);
  box = result.json().id;
}, 30000);
afterAll(async () => {
  await app.close();
  await resources.close();
  await connection.quit();
  await db.destroy();
  await rm(dir, { recursive: true, force: true });
});
it('creates local boxes, excludes provider quota and protects import/export by tenant/admin', async () => {
  const storage = await call('GET', `/mailboxes/${box}/storage`);
  expect(storage.json()).toMatchObject({
    provider_status: 'not_applicable',
    provider_used_bytes: null,
    provider_limit_bytes: null,
  });
  expect(
    (
      await call(
        'POST',
        `/mailboxes/${box}/archive-imports/preflight`,
        { filename: 'x.eml', size_bytes: 1 },
        member,
      )
    ).statusCode,
  ).toBe(403);
  expect(
    (await call('GET', `/mailboxes/${box}/archive-export?format=mbox`, undefined, foreignOwner))
      .statusCode,
  ).toBe(404);
  expect(
    (await call('GET', `/mailboxes/${box}/archive-export?format=eml`, undefined, member))
      .statusCode,
  ).toBe(403);
  const used = (
    await sql<{
      bytes: string;
    }>`select storage_quota_usage(${tenant}::uuid)::text as bytes`.execute(db)
  ).rows[0]!.bytes;
  await sql`update tenant_storage_limits set storage_limit_bytes=${(BigInt(used) + 20000n).toString()}::bigint where tenant_id=${tenant}::uuid`.execute(
    db,
  );
  expect(
    (
      await call('POST', `/mailboxes/${box}/archive-imports/preflight`, {
        filename: 'large.pst',
        size_bytes: 20001,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await call('POST', `/mailboxes/${box}/archive-imports/preflight`, {
        filename: 'near.pst',
        size_bytes: 19000,
      })
    ).json().near_limit,
  ).toBe(true);
  await sql`update tenant_storage_limits set storage_limit_bytes=null where tenant_id=${tenant}::uuid`.execute(
    db,
  );
});
it('imports MIME with exact raw backup, charges ownership and skips repeated emails', async () => {
  const raw = mime('one'),
    id = await upload(raw);
  await handleMailArchive(r, id, 'qa-' + id);
  expect(await state(id)).toMatchObject({
    state: 'completed',
    cursor: 1,
    imported: 1,
    storage_path: null,
  });
  const message = await db
    .selectFrom('messages')
    .selectAll()
    .where('mailbox_id', '=', box)
    .where('message_id_header', '=', '<one@qa.example>')
    .executeTakeFirstOrThrow();
  expect(message.is_historical).toBe(true);
  expect(message.imap_uid).toBeNull();
  expect(message.source_kind).toBe('archive');
  const chunks = [];
  for await (const value of await r.storage.openReadStream(message.raw_storage_path!))
    chunks.push(value);
  expect(Buffer.concat(chunks).equals(raw)).toBe(true);
  const asset = await db
    .selectFrom('storage_assets')
    .select(['tenant_id', 'mailbox_id', 'category', 'state'])
    .where('storage_key', '=', message.raw_storage_path!)
    .executeTakeFirstOrThrow();
  expect(asset).toEqual({
    tenant_id: tenant,
    mailbox_id: box,
    category: 'mail_raw',
    state: 'present',
  });
  const second = await upload(raw);
  await handleMailArchive(r, second, 'qa-' + second);
  expect(await state(second)).toMatchObject({ imported: 0, skipped: 1, state: 'completed' });
  const mbox = await call('GET', `/mailboxes/${box}/archive-export?format=mbox`);
  expect(mbox.statusCode, mbox.body).toBe(200);
  expect(mbox.body).toContain('Message-ID: <one@qa.example>');
  expect(mbox.body).toContain('Olá');
  const zip = await call('GET', `/mailboxes/${box}/archive-export?format=eml`);
  expect(zip.statusCode, zip.body.slice(0, 100)).toBe(200);
  expect(zip.rawPayload.subarray(0, 2).toString()).toBe('PK');
  await r.storage.writeFile(`mail-imports/${tenant}/${box}/qa-export.zip`, zip.rawPayload);
  const extracted = [];
  for await (const item of readMailArchive(
    join(dir, `mail-imports/${tenant}/${box}/qa-export.zip`),
    'zip',
  ))
    extracted.push(item);
  expect(extracted).toHaveLength(1);
  expect(extracted[0]!.raw.equals(raw)).toBe(true);
  await r.storage.removeFile(`mail-imports/${tenant}/${box}/qa-export.zip`);
}, 30000);
it('preserves per-message checkpoint at quota and resumes without duplicating the committed message', async () => {
  const first = mime('checkpoint-first'),
    second = mime('checkpoint-second', 'X'.repeat(65536)),
    content = Buffer.concat([
      toMbox(first, new Date(), 'a@example.com'),
      toMbox(second, new Date(), 'a@example.com'),
    ]);
  const id = await upload(content, 'backup.mbox');
  await db
    .insertInto('folders')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      name: 'backup',
      imap_path: 'local/importados/backup',
      is_local: true,
    })
    .onConflict((oc) =>
      oc.columns(['mailbox_id', 'imap_path']).where('deleted_at', 'is', null).doNothing(),
    )
    .execute();
  const used = (
    await sql<{
      bytes: string;
    }>`select storage_quota_usage(${tenant}::uuid)::text as bytes`.execute(db)
  ).rows[0]!.bytes;
  await sql`update tenant_storage_limits set storage_limit_bytes=${(BigInt(used) + 10000n).toString()}::bigint where tenant_id=${tenant}::uuid`.execute(
    db,
  );
  await handleMailArchive(r, id, 'qa-' + id);
  expect(await state(id)).toMatchObject({ state: 'paused', cursor: 1, imported: 1 });
  await sql`update tenant_storage_limits set storage_limit_bytes=null where tenant_id=${tenant}::uuid`.execute(
    db,
  );
  expect((await call('POST', `/mailboxes/${box}/archive-imports/${id}/resume`)).statusCode).toBe(
    200,
  );
  await handleMailArchive(r, id, 'qa-resume-' + id);
  expect(await state(id)).toMatchObject({ state: 'completed', cursor: 2, imported: 2 });
  expect(
    await db
      .selectFrom('messages')
      .select('id')
      .where('mailbox_id', '=', box)
      .where('message_id_header', 'in', [
        '<checkpoint-first@qa.example>',
        '<checkpoint-second@qa.example>',
      ])
      .execute(),
  ).toHaveLength(2);
}, 30000);
it('rejects mismatched upload content/size and cancels the retained source explicitly', async () => {
  const raw = mime('cancel'),
    id = await upload(raw);
  expect((await call('POST', `/mailboxes/${box}/archive-imports/${id}/cancel`)).statusCode).toBe(
    200,
  );
  expect(await state(id)).toMatchObject({ state: 'cancelled', storage_path: null });
  const task = (
    await call('POST', `/mailboxes/${box}/archive-imports`, {
      filename: 'bad.pst',
      size_bytes: raw.length,
    })
  ).json();
  expect(
    (await call('POST', `/mailboxes/${box}/archive-imports/${task.id}/upload`, raw)).statusCode,
  ).toBe(422);
  expect((await state(task.id)).state).toBe('failed');
});
it('purges only deleted archive contents while retaining source keys to prevent redownload', async () => {
  const message = await db
    .selectFrom('messages')
    .selectAll()
    .where('mailbox_id', '=', box)
    .where('message_id_header', '=', '<one@qa.example>')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('messages')
    .set({ deleted_at: new Date() })
    .where('id', '=', message.id)
    .execute();
  const result = await call('POST', `/mailboxes/${box}/archive-purge-deleted`, { confirm: true });
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().purged).toBe(1);
  const saved = await db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', message.id)
    .executeTakeFirstOrThrow();
  expect(saved.raw_storage_path).toBeNull();
  expect(saved.body_text).toBe('');
  expect(saved.source_key).toBe(message.source_key);
  expect(saved.deleted_at).not.toBeNull();
  expect(
    (
      await db
        .selectFrom('storage_assets')
        .select('state')
        .where('storage_key', '=', message.raw_storage_path!)
        .executeTakeFirst()
    )?.state,
  ).toBe('deleted');
});

it('receives POP3 continuously, keeps server messages and resumes quota by UIDL without redownload', async () => {
  const messages = [
    { uid: 'stable-a', raw: mime('pop-a') },
    { uid: 'stable-b', raw: mime('pop-b') },
  ];
  const commands: string[] = [];
  const server = createServer((socket) => {
    socket.write('+OK QA POP3\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('ascii');
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const command = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const [verb, n] = command.split(' ');
        commands.push(verb!);
        if (verb === 'USER' || verb === 'PASS') socket.write('+OK\r\n');
        else if (verb === 'UIDL' || verb === 'LIST')
          socket.write(
            '+OK\r\n' +
              messages
                .map((m, i) => `${i + 1} ${verb === 'UIDL' ? m.uid : m.raw.length}`)
                .join('\r\n') +
              '\r\n.\r\n',
          );
        else if (verb === 'RETR') {
          const raw = messages[Number(n) - 1]!.raw.toString('latin1').replace(/^\./gm, '..');
          socket.write(Buffer.from('+OK\r\n' + raw + '.\r\n', 'latin1'));
        } else if (verb === 'QUIT') socket.end('+OK\r\n');
        else socket.write('-ERR\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const popBox = await db
      .insertInto('mailboxes')
      .values({
        tenant_id: tenant,
        name: 'POP QA',
        email_address: 'pop@example.com',
        receiving_protocol: 'pop3',
        imap_host: '127.0.0.1',
        imap_port: (server.address() as { port: number }).port,
        imap_secure: false,
        smtp_host: 'localhost',
        smtp_port: 465,
        smtp_secure: true,
        username: 'qa',
        status: 'active',
        history_classify_days: 0,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    await writeMailboxCredential(db, tenant, popBox.id, 'qa', key);
    const popResources = {
      ...r,
      env: workerEnv.parse({
        ...env,
        NODE_ENV: 'development',
        ALLOW_INSECURE_TLS_HOSTS: '127.0.0.1',
      }),
    };
    await handleMailboxSync(popResources, popBox.id, 'pop-qa-first');
    const first = await db
      .selectFrom('messages')
      .selectAll()
      .where('mailbox_id', '=', popBox.id)
      .execute();
    expect(first).toHaveLength(2);
    expect(
      first.every((m) => m.is_historical && m.source_kind === 'pop3' && !!m.raw_storage_path),
    ).toBe(true);
    await db
      .updateTable('messages')
      .set({ deleted_at: new Date() })
      .where('id', '=', first[0]!.id)
      .execute();
    messages.reverse();
    messages.push({ uid: 'stable-c', raw: mime('pop-c', 'X'.repeat(65536)) });
    const usage = (
      await sql<{
        bytes: string;
      }>`select storage_quota_usage(${tenant}::uuid)::text as bytes`.execute(db)
    ).rows[0]!.bytes;
    await sql`update tenant_storage_limits set storage_limit_bytes=${(BigInt(usage) + 10000n).toString()}::bigint where tenant_id=${tenant}::uuid`.execute(
      db,
    );
    await handleMailboxSync(popResources, popBox.id, 'pop-qa-pause');
    const paused = (
      await sql<{
        paused_at: Date | null;
        sync_checkpoint: unknown;
      }>`select paused_at,sync_checkpoint from mailbox_storage_limits where mailbox_id=${popBox.id}::uuid`.execute(
        db,
      )
    ).rows[0]!;
    expect(paused.paused_at).not.toBeNull();
    expect(paused.sync_checkpoint).toMatchObject({ protocol: 'pop3', uidl: 'stable-c' });
    const before = commands.filter((c) => c === 'RETR').length;
    await handleMailboxSync(popResources, popBox.id, 'pop-qa-no-retry');
    expect(commands.filter((c) => c === 'RETR')).toHaveLength(before);
    await sql`update tenant_storage_limits set storage_limit_bytes=null where tenant_id=${tenant}::uuid`.execute(
      db,
    );
    await handleMailboxSync(popResources, popBox.id, 'pop-qa-resume');
    const saved = await db
      .selectFrom('messages')
      .selectAll()
      .where('mailbox_id', '=', popBox.id)
      .execute();
    expect(saved).toHaveLength(3);
    expect(saved.find((m) => m.source_key === 'stable-c')?.is_historical).toBe(false);
    expect(commands.filter((c) => c === 'RETR')).toHaveLength(4);
    expect(commands).not.toContain('DELE');
    expect(
      (
        await sql<{
          sync_checkpoint: unknown;
        }>`select sync_checkpoint from mailbox_storage_limits where mailbox_id=${popBox.id}::uuid`.execute(
          db,
        )
      ).rows[0]?.sync_checkpoint,
    ).toBeNull();
    expect((await call('GET', `/mailboxes/${popBox.id}/storage`)).json().provider_status).toBe(
      'not_applicable',
    );
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
}, 30000);

it('keeps imported folder hierarchy and messages when remote IMAP folders are refreshed', async () => {
  const mailbox = await db
    .selectFrom('mailboxes')
    .selectAll()
    .where('id', '=', box)
    .executeTakeFirstOrThrow();
  const imported = await db
    .selectFrom('folders')
    .selectAll()
    .where('mailbox_id', '=', box)
    .where('imap_path', '=', 'local/importados/backup')
    .executeTakeFirstOrThrow();
  expect(imported.parent_id).not.toBeNull();
  await syncFolders(r, mailbox, { list: async () => [] } as unknown as ImapFlow);
  expect(
    (
      await db
        .selectFrom('folders')
        .select('deleted_at')
        .where('id', '=', imported.id)
        .executeTakeFirst()
    )?.deleted_at,
  ).toBeNull();
  expect(
    await db
      .selectFrom('messages')
      .select('id')
      .where('folder_id', '=', imported.id)
      .where('deleted_at', 'is', null)
      .execute(),
  ).toHaveLength(2);
});

it('organizes local archive folders and messages without provider credentials or connections', async () => {
  const created = await call('POST', `/mailboxes/${box}/folders`, { name: 'Local QA' });
  expect(created.statusCode, created.body).toBe(202);
  const run = async (id: string) => handleMailAction(r, id, 'action-qa-' + id, true);
  await run(created.json().action_id);
  const folder = await db
    .selectFrom('folders')
    .selectAll()
    .where('mailbox_id', '=', box)
    .where('imap_path', '=', 'Local QA')
    .executeTakeFirstOrThrow();
  expect(folder.is_local).toBe(true);
  const child = await call('POST', `/mailboxes/${box}/folders`, {
    name: 'Child',
    parent_id: folder.id,
  });
  expect(child.statusCode, child.body).toBe(202);
  await run(child.json().action_id);
  const renamed = await call('PATCH', `/folders/${folder.id}`, { name: 'Renamed QA' });
  expect(renamed.statusCode, renamed.body).toBe(202);
  await run(renamed.json().action_id);
  expect(
    (
      await db
        .selectFrom('folders')
        .select('imap_path')
        .where('parent_id', '=', folder.id)
        .executeTakeFirst()
    )?.imap_path,
  ).toBe('Renamed QA/Child');
  const message = await db
    .selectFrom('messages')
    .selectAll()
    .where('mailbox_id', '=', box)
    .where('message_id_header', '=', '<checkpoint-first@qa.example>')
    .executeTakeFirstOrThrow();
  const moved = await call('POST', `/mailboxes/${box}/messages/actions`, {
    type: 'move',
    message_ids: [message.id],
    target_folder_id: folder.id,
  });
  expect(moved.statusCode, moved.body).toBe(202);
  await run(moved.json().action_id);
  expect(
    await db
      .selectFrom('messages')
      .select(['folder_id', 'pending_action'])
      .where('id', '=', message.id)
      .executeTakeFirst(),
  ).toEqual({ folder_id: folder.id, pending_action: false });
  const deletion = await call('POST', `/mailboxes/${box}/messages/actions`, {
    type: 'delete',
    message_ids: [message.id],
  });
  expect(deletion.statusCode, deletion.body).toBe(202);
  await run(deletion.json().action_id);
  const permanent = await call('POST', `/mailboxes/${box}/messages/actions`, {
    type: 'delete',
    message_ids: [message.id],
  });
  expect(permanent.statusCode, permanent.body).toBe(202);
  await run(permanent.json().action_id);
  const deleted = await db
    .selectFrom('messages')
    .select(['deleted_at', 'source_key', 'pending_action'])
    .where('id', '=', message.id)
    .executeTakeFirstOrThrow();
  expect(deleted.deleted_at).not.toBeNull();
  expect(deleted.pending_action).toBe(false);
  expect(deleted.source_key).toBe(message.source_key);
}, 30000);
