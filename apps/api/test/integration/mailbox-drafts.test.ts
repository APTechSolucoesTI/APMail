import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, migrate } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';

const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Banco exclusivo obrigatório.');
const db = createDb(url),
  tenant = randomUUID(),
  owner = randomUUID(),
  member = randomUUID();
const box = randomUUID(),
  otherBox = randomUUID(),
  folder = randomUUID(),
  thread = randomUUID();
const draft = randomUUID(),
  otherDraft = randomUUID(),
  imported = randomUUID();
const secret = randomBytes(32).toString('base64'),
  origin = 'http://localhost:5173';
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: process.env.REDIS_URL_TEST!,
    APP_URL: origin,
    SESSION_SECRET: secret,
    CREDENTIALS_ENCRYPTION_KEY: secret,
    STORAGE_DIR: join(tmpdir(), 'apmail-drafts-' + tenant),
  }),
);
const cookies = new Map<string, string>();
const call = (path: string, user = member) =>
  app.inject({ method: 'GET', url: path, headers: { origin, cookie: cookies.get(user)! } });
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db.insertInto('tenants').values({ id: tenant, name: 'Draft QA', slug: tenant }).execute();
  for (const [id, role] of [
    [owner, 'owner'],
    [member, 'member'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@qa.local',
        full_name: 'Draft QA',
        password_hash: 'fixture',
        current_tenant_id: tenant,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tenant, user_id: id, role })
      .execute();
    const token = randomBytes(32).toString('base64url');
    await db
      .insertInto('sessions')
      .values({
        user_id: id,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 3600000),
      })
      .execute();
    cookies.set(id, 'apmail_session=' + encodeURIComponent(app.signCookie(token)));
  }
  for (const id of [box, otherBox])
    await db
      .insertInto('mailboxes')
      .values({
        id,
        tenant_id: tenant,
        name: 'Draft box',
        email_address: id + '@qa.local',
        username: 'qa',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        status: 'active',
      })
      .execute();
  await db
    .insertInto('mailbox_members')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      user_id: member,
      role: 'editor',
      restrict_to_folders: true,
    })
    .execute();
  await db
    .insertInto('folders')
    .values({
      id: folder,
      tenant_id: tenant,
      mailbox_id: box,
      name: 'Drafts',
      imap_path: 'Drafts',
      special_use: 'drafts',
    })
    .execute();
  await db
    .insertInto('threads')
    .values({ id: thread, tenant_id: tenant, mailbox_id: box })
    .execute();
  await db
    .insertInto('messages')
    .values({
      id: imported,
      tenant_id: tenant,
      mailbox_id: box,
      thread_id: thread,
      folder_id: folder,
      direction: 'outbound',
      subject: 'Imported draft',
      message_id_header: '<' + imported + '@qa.local>',
      message_at: new Date(),
    })
    .execute();
  for (const [id, user] of [
    [draft, member],
    [otherDraft, owner],
  ] as const)
    await db
      .insertInto('outbox')
      .values({
        id,
        tenant_id: tenant,
        mailbox_id: box,
        created_by: user,
        subject: 'Private draft',
        status: 'draft',
      })
      .execute();
}, 120000);
afterAll(async () => {
  await app.close();
  await db.destroy();
});
it('lists private composer drafts without exposing another user draft or restricted provider folder', async () => {
  const result = await call(`/api/mailboxes/${box}/drafts`);
  expect(result.statusCode).toBe(200);
  expect(result.json().items.map((r: { id: string }) => r.id)).toEqual([draft]);
  expect(result.json().items[0]).toMatchObject({ source: 'draft', can_edit: true });
});
it('includes provider drafts only in readable folders and paginates/searches both sources', async () => {
  await db
    .insertInto('folder_permissions')
    .values({ tenant_id: tenant, mailbox_id: box, user_id: member, folder_id: folder })
    .execute();
  const result = await call(`/api/mailboxes/${box}/drafts`);
  expect(result.json().total).toBe(2);
  expect(
    result
      .json()
      .items.map((r: { id: string }) => r.id)
      .sort(),
  ).toEqual([draft, imported].sort());
  const filtered = await call(`/api/mailboxes/${box}/drafts?q=Imported&page=1&page_size=25`);
  expect(filtered.statusCode, filtered.body).toBe(200);
  expect(filtered.json().pageSize).toBe(25);
  expect(filtered.json().items).toHaveLength(1);
  expect(filtered.json().items[0]).toMatchObject({
    source: 'message',
    id: imported,
    thread_id: thread,
  });
  expect((await call(`/api/mailboxes/${box}/drafts?page=2&page_size=10`)).json().items).toEqual([]);
});
it('denies unassigned mailboxes and never exposes another user draft through detail', async () => {
  expect((await call(`/api/mailboxes/${otherBox}/drafts`)).statusCode).toBe(404);
  expect((await call('/api/outbox/' + otherDraft)).statusCode).toBe(404);
});
it('opens a private draft with mail permissions even when Envios access is disabled', async () => {
  await db
    .updateTable('tenant_members')
    .set({ custom_permissions: ['mail', 'mail.send'] })
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', member)
    .execute();
  expect((await call(`/api/mailboxes/${box}/drafts`)).statusCode).toBe(200);
  expect((await call('/api/outbox/' + draft)).statusCode).toBe(200);
  expect((await call('/api/outbox?tab=scheduled')).statusCode).toBe(403);
});
it('keeps edits in the same saved draft and excludes it once scheduled', async () => {
  const edited = await app.inject({
    method: 'PATCH',
    url: '/api/outbox/' + draft,
    headers: { origin, cookie: cookies.get(member)!, 'content-type': 'application/json' },
    payload: JSON.stringify({ subject: 'Updated saved draft', body_html: '<p>Preserved body</p>' }),
  });
  expect(edited.statusCode).toBe(200);
  expect(edited.json()).toMatchObject({
    id: draft,
    subject: 'Updated saved draft',
    status: 'draft',
  });
  expect((await call(`/api/mailboxes/${box}/drafts?q=Updated`)).json().items).toHaveLength(1);
  await db.updateTable('outbox').set({ status: 'scheduled' }).where('id', '=', draft).execute();
  expect((await call(`/api/mailboxes/${box}/drafts?q=Updated`)).json().total).toBe(0);
  expect((await call('/api/outbox/' + draft)).statusCode).toBe(403);
});
it('denies draft access after mailbox membership is revoked', async () => {
  await db
    .deleteFrom('mailbox_members')
    .where('mailbox_id', '=', box)
    .where('user_id', '=', member)
    .execute();
  expect((await call(`/api/mailboxes/${box}/drafts`)).statusCode).toBe(404);
  expect((await call('/api/outbox/' + draft)).statusCode).toBe(403);
});
