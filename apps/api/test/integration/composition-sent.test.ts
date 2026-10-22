import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDb, migrate, touchThreads } from '@apmail/db';
import { DEFAULT_COMPOSITION_FORMAT } from '@apmail/shared';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';
const url = process.env.DATABASE_URL_TEST!,
  redis = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('TEST obrigatório');
const db = createDb(url),
  tenant = randomUUID(),
  otherTenant = randomUUID(),
  owner = randomUUID(),
  colleague = randomUUID(),
  stranger = randomUUID(),
  box = randomUUID(),
  otherBox = randomUUID(),
  inbox = randomUUID(),
  sent = randomUUID(),
  thread = randomUUID(),
  incoming = randomUUID(),
  first = randomUUID(),
  second = randomUUID();
const origin = 'http://localhost:5173',
  cookies = new Map<string, string>();
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redis,
    APP_URL: origin,
    SESSION_SECRET: randomBytes(32).toString('base64'),
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  }),
);
const call = (method: 'GET' | 'PUT', path: string, user = owner, payload?: unknown) =>
  app.inject({
    method,
    url: '/api' + path,
    headers: {
      origin,
      cookie: cookies.get(user)!,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  for (const id of [tenant, otherTenant])
    await db
      .insertInto('tenants')
      .values({ id, name: 'Composição QA', slug: 'composition-' + id })
      .execute();
  for (const id of [owner, colleague, stranger]) {
    const tid = id === stranger ? otherTenant : tenant;
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@qa.example',
        full_name: 'QA',
        password_hash: 'fixture',
        current_tenant_id: tid,
      })
      .execute();
    await db.insertInto('user_preferences').values({ user_id: id }).execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tid, user_id: id, role: 'owner' })
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
        tenant_id: id === box ? tenant : otherTenant,
        name: 'Composição',
        email_address: id + '@qa.example',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        username: 'qa',
        status: 'disabled',
      })
      .execute();
  await db
    .insertInto('folders')
    .values([
      {
        id: inbox,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'INBOX',
        imap_path: 'INBOX',
        special_use: 'inbox',
      },
      {
        id: sent,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'Sent',
        imap_path: 'Sent',
        special_use: 'sent',
      },
    ])
    .execute();
  await db
    .insertInto('threads')
    .values({ id: thread, tenant_id: tenant, mailbox_id: box, subject: 'Conversa completa' })
    .execute();
  for (const [i, id] of [incoming, first, second].entries())
    await db
      .insertInto('messages')
      .values({
        id,
        tenant_id: tenant,
        mailbox_id: box,
        thread_id: thread,
        folder_id: i === 0 ? inbox : sent,
        direction: i === 0 ? 'inbound' : 'outbound',
        subject: i === 0 ? 'Mensagem recebida' : 'Enviado ' + i,
        from_address: i === 0 ? 'client@qa.example' : 'box@qa.example',
        to_addresses: JSON.stringify([{ address: 'client@qa.example', name: 'Cliente' }]),
        body_text: 'Conteúdo exclusivo ' + i,
        body_html: '<p>Conteúdo exclusivo ' + i + '</p>',
        message_id_header: '<' + id + '@qa.example>',
        message_at: new Date(Date.now() + i * 1000),
      })
      .execute();
  await touchThreads(db, [thread], 'sync', null);
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
it('persists personal defaults and mailbox overrides independently for each user', async () => {
  const format = { ...DEFAULT_COMPOSITION_FORMAT, color: '#123456', bold: true };
  const response = await call('PUT', '/preferences/composition', owner, {
    mailbox_id: null,
    format,
  });
  expect(response.statusCode, response.body).toBe(200);
  const override = { ...format, font_size: 20 };
  expect(
    (await call('PUT', '/preferences/composition', owner, { mailbox_id: box, format: override }))
      .statusCode,
  ).toBe(200);
  expect((await call('GET', '/preferences/composition')).json()).toEqual({
    default_format: format,
    overrides: [{ mailbox_id: box, format: override }],
  });
  expect((await call('GET', '/preferences/composition', colleague)).json()).toEqual({
    default_format: DEFAULT_COMPOSITION_FORMAT,
    overrides: [],
  });
  expect(
    (await call('PUT', '/preferences/composition', owner, { mailbox_id: otherBox, format }))
      .statusCode,
  ).toBe(404);
  expect(
    (await call('PUT', '/preferences/composition', stranger, { mailbox_id: box, format }))
      .statusCode,
  ).toBe(404);
  expect(
    (
      await call('PUT', '/preferences/composition', owner, {
        mailbox_id: null,
        format: { ...format, color: 'javascript:alert(1)' },
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await call('PUT', '/preferences/composition', owner, { mailbox_id: box, format: null }))
      .statusCode,
  ).toBe(200);
  expect((await call('GET', '/preferences/composition')).json().overrides).toEqual([]);
});
it('lists every sent message separately, without incoming messages or conversation aggregation', async () => {
  const result = await call('GET', `/mailboxes/${box}/threads?view=folder&folder_id=${sent}`);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().total).toBe(2);
  expect(result.json().items.map((item: { message_id: string }) => item.message_id)).toEqual([
    second,
    first,
  ]);
  expect(
    result.json().items.every((item: { message_count: number }) => item.message_count === 1),
  ).toBe(true);
  const page = (
    await call('GET', `/mailboxes/${box}/threads?view=folder&folder_id=${sent}&sort=oldest`)
  ).json();
  expect(page.items[0].subject).toBe('Enviado 1');
});
it('opens exactly the selected sent message and keeps normal inbox conversations complete', async () => {
  const result = await call('GET', `/threads/${thread}?message_id=${first}`);
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().messages.map((message: { id: string }) => message.id)).toEqual([first]);
  expect(result.json().thread.subject).toBe('Enviado 1');
  expect((await call('GET', `/threads/${thread}`)).json().messages).toHaveLength(3);
  expect((await call('GET', `/threads/${thread}?message_id=${randomUUID()}`)).statusCode).toBe(404);
  expect((await call('GET', `/threads/${thread}?message_id=${first}`, stranger)).statusCode).toBe(
    404,
  );
});
it('searches only the matching sent message and resolves legacy links independently of pagination', async () => {
  const result = await call(
    'GET',
    `/mailboxes/${box}/threads?view=folder&folder_id=${sent}&q=Enviado%201`,
  );
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().total).toBe(1);
  expect(result.json().items[0].message_id).toBe(first);
  const legacy = await call('GET', `/threads/${thread}?folder_id=${sent}`);
  expect(legacy.statusCode, legacy.body).toBe(200);
  expect(legacy.json().messages.map((m: { id: string }) => m.id)).toEqual([second]);
  expect(
    (await call('GET', `/threads/${thread}?folder_id=${sent}&message_id=${incoming}`)).statusCode,
  ).toBe(404);
  expect((await call('GET', `/threads/${thread}?folder_id=${randomUUID()}`)).statusCode).toBe(404);
});
