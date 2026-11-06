import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDb, migrate } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';

const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('TEST obrigatório');
const db = createDb(url),
  tenant = randomUUID(),
  user = randomUUID(),
  other = randomUUID(),
  limited = randomUUID();
const box = randomUUID(),
  second = randomUUID(),
  a = randomUUID(),
  b = randomUUID(),
  child = randomUUID();
const hiddenThread = randomUUID(),
  hiddenMessage = randomUUID(),
  visibleThread = randomUUID(),
  visibleMessage = randomUUID();
const origin = 'http://localhost:5173';
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: process.env.REDIS_URL_TEST,
    APP_URL: origin,
    SESSION_SECRET: randomBytes(32).toString('base64'),
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  }),
);
const cookies = new Map<string, string>();
const call = (method: 'GET' | 'PATCH', payload?: unknown, who = user) =>
  app.inject({
    method,
    url: '/api/preferences/mail-navigation',
    headers: { origin, cookie: cookies.get(who)! },
    ...(payload ? { payload } : {}),
  });
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values({ id: tenant, name: 'Organização QA', slug: 'navigation-' + tenant })
    .execute();
  for (const id of [user, other, limited]) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@navigation.test',
        full_name: 'Pessoa QA',
        password_hash: 'fixture',
        current_tenant_id: tenant,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tenant, user_id: id, role: id === limited ? 'member' : 'owner' })
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
  for (const [id, name] of [
    [box, 'Comercial'],
    [second, 'Financeiro'],
  ])
    await db
      .insertInto('mailboxes')
      .values({
        id,
        tenant_id: tenant,
        name: name!,
        email_address: id + '@navigation.test',
        imap_host: 'local',
        smtp_host: 'local',
        username: 'qa',
        receiving_protocol: 'local',
        status: 'active',
      })
      .execute();
  await db
    .insertInto('folders')
    .values([
      {
        id: a,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'Zeta',
        imap_path: 'Zeta',
        is_local: true,
        sort_order: 1,
      },
      {
        id: b,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'Alfa',
        imap_path: 'Alfa',
        is_local: true,
        sort_order: 2,
      },
      {
        id: child,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'Filha',
        imap_path: 'Zeta/Filha',
        parent_id: a,
        is_local: true,
      },
    ])
    .execute();
  await db
    .insertInto('mailbox_members')
    .values([
      ...[user, other].flatMap((userId) =>
        [box, second].map((mailboxId) => ({
          tenant_id: tenant,
          mailbox_id: mailboxId,
          user_id: userId,
          role: 'mailbox_admin' as const,
        })),
      ),
      {
        tenant_id: tenant,
        mailbox_id: box,
        user_id: limited,
        role: 'editor',
        restrict_to_folders: true,
      },
    ])
    .execute();
  await db
    .insertInto('folder_permissions')
    .values({ tenant_id: tenant, mailbox_id: box, user_id: limited, folder_id: a })
    .execute();
  for (const [thread, message, folder] of [
    [hiddenThread, hiddenMessage, b],
    [visibleThread, visibleMessage, a],
  ]) {
    await db
      .insertInto('threads')
      .values({
        id: thread,
        tenant_id: tenant,
        mailbox_id: box,
        subject: 'Escopo',
        subject_normalized: 'escopo',
      })
      .execute();
    await db
      .insertInto('messages')
      .values({
        id: message,
        tenant_id: tenant,
        mailbox_id: box,
        thread_id: thread!,
        folder_id: folder!,
        direction: 'inbound',
        from_address: 'qa@example.test',
        subject: 'Escopo',
        message_id_header: '<' + message + '@qa.test>',
        message_at: new Date(),
        source_kind: 'archive',
      })
      .execute();
  }
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
it('persists independent mailbox order, sibling order and folder favorites per person', async () => {
  expect((await call('PATCH', { type: 'mailboxes', ids: [second, box] })).statusCode).toBe(200);
  expect(
    (await call('PATCH', { type: 'folders', mailbox_id: box, parent_id: null, ids: [b, a] }))
      .statusCode,
  ).toBe(200);
  expect(
    (await call('PATCH', { type: 'favorite', mailbox_id: box, folder_id: child, value: true }))
      .statusCode,
  ).toBe(200);
  expect((await call('GET')).json()).toMatchObject({
    mailbox_order: [second, box],
    folder_orders: { [box + ':root']: [b, a] },
    favorite_folder_ids: [child],
  });
  expect((await call('GET', undefined, other)).json()).toMatchObject({
    mailbox_order: [],
    folder_orders: {},
    favorite_folder_ids: [],
  });
  expect(
    (
      await call('PATCH', { type: 'favorite', mailbox_id: box, folder_id: child, value: false })
    ).json().favorite_folder_ids,
  ).toEqual([]);
});
it('rejects cross-level reorders and inaccessible identifiers without changing hierarchy', async () => {
  expect(
    (await call('PATCH', { type: 'folders', mailbox_id: box, parent_id: null, ids: [a, child] }))
      .statusCode,
  ).toBe(409);
  expect(
    (await call('PATCH', { type: 'favorite', mailbox_id: second, folder_id: a, value: true }))
      .statusCode,
  ).toBe(404);
  expect((await call('PATCH', { type: 'mailboxes', ids: [randomUUID()] })).statusCode).toBe(404);
  expect(
    (
      await db
        .selectFrom('folders')
        .select('parent_id')
        .where('id', '=', child)
        .executeTakeFirstOrThrow()
    ).parent_id,
  ).toBe(a);
});
it('returns original persisted folder order instead of alphabetic order', async () => {
  const response = await app.inject({
    url: '/api/mailboxes/' + box + '/folders',
    headers: { cookie: cookies.get(other)! },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().map((f: { id: string }) => f.id)).toEqual([a, b]);
});
it('denies hidden favorite identifiers and moves outside readable source or destination folders', async () => {
  expect(
    (await call('PATCH', { type: 'favorite', mailbox_id: box, folder_id: b, value: true }, limited))
      .statusCode,
  ).toBe(404);
  const move = (message: string, target: string) =>
    app.inject({
      method: 'POST',
      url: '/api/mailboxes/' + box + '/messages/actions',
      headers: { origin, cookie: cookies.get(limited)! },
      payload: { type: 'move', message_ids: [message], target_folder_id: target },
    });
  expect((await move(hiddenMessage, a)).statusCode).toBe(403);
  expect((await move(visibleMessage, b)).statusCode).toBe(403);
  expect(
    (
      await db
        .selectFrom('messages')
        .select('folder_id')
        .where('id', '=', hiddenMessage)
        .executeTakeFirstOrThrow()
    ).folder_id,
  ).toBe(b);
});
it('persists domain order per person and rejects labels outside current accessible mailbox domains', async () => {
  await db
    .updateTable('mailboxes')
    .set({ email_address: 'finance@finance.test' })
    .where('id', '=', second)
    .execute();
  expect((await call('GET', undefined, other)).json().domain_order).toEqual([]);
  const response = await call('PATCH', {
    type: 'domains',
    ids: ['finance.test', 'navigation.test'],
  });
  expect(response.statusCode, response.body).toBe(200);
  expect((await call('GET')).json().domain_order).toEqual(['finance.test', 'navigation.test']);
  expect((await call('GET', undefined, other)).json().domain_order).toEqual([]);
  expect(
    (await call('PATCH', { type: 'domains', ids: ['finance.test', 'navigation.test'] }, limited))
      .statusCode,
  ).toBe(404);
  expect(
    (await call('PATCH', { type: 'domains', ids: ['navigation.test'] }, limited)).statusCode,
  ).toBe(200);
  expect(
    (await call('PATCH', { type: 'domains', ids: ['arbitrary-private.test'] })).statusCode,
  ).toBe(404);
  expect(
    (await call('PATCH', { type: 'domains', ids: ['finance.test', 'finance.test'] })).statusCode,
  ).toBe(400);
  expect((await call('GET')).json().domain_order).toEqual(['finance.test', 'navigation.test']);
});

it('returns flags and sent replies only within the readable row scope and separates personal pin state', async () => {
  const sent = randomUUID(),
    reply = randomUUID(),
    followup = randomUUID(),
    unrelated = randomUUID();
  const header = (message: string) => `<${message}@qa.test>`;
  const list = async (path: string, who = user) => {
    const response = await app.inject({
      url: '/api' + path,
      headers: { origin, cookie: cookies.get(who)! },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json().items as {
      id: string;
      message_id: string | null;
      has_reply: boolean;
      is_flagged: boolean;
      is_pinned_personal: boolean;
      is_pinned_global: boolean;
    }[];
  };
  await db
    .insertInto('folders')
    .values({
      id: sent,
      tenant_id: tenant,
      mailbox_id: box,
      name: 'Enviados',
      imap_path: 'Sent',
      special_use: 'sent',
      is_local: true,
    })
    .execute();
  await db
    .updateTable('threads')
    .set({ is_pinned_global: true })
    .where('id', '=', visibleThread)
    .execute();
  const insertSent = (id: string, in_reply_to: string | null, is_flagged: boolean) =>
    db
      .insertInto('messages')
      .values({
        id,
        tenant_id: tenant,
        mailbox_id: box,
        thread_id: visibleThread,
        folder_id: sent,
        direction: 'outbound',
        message_id_header: header(id),
        in_reply_to,
        is_flagged,
        message_at: new Date(),
        source_kind: 'archive',
        from_address: 'owner@navigation.test',
        subject: 'Saída de teste',
      })
      .execute();
  const search = '/mail-summary/threads?view=search';
  await insertSent(unrelated, null, false);
  expect((await list(search)).find((row) => row.id === visibleThread)).toMatchObject({
    has_reply: false,
    is_flagged: false,
    is_pinned_personal: false,
    is_pinned_global: true,
  });
  await insertSent(reply, header(visibleMessage), true);
  await insertSent(followup, header(reply), false);
  expect((await list(search)).find((row) => row.id === visibleThread)).toMatchObject({
    has_reply: true,
    is_flagged: true,
  });
  expect((await list(search, limited)).find((row) => row.id === visibleThread)).toMatchObject({
    has_reply: false,
    is_flagged: false,
  });
  const rows = await list('/mailboxes/' + box + '/threads?view=folder&folder_id=' + sent);
  expect(rows.find((row) => row.message_id === reply)).toMatchObject({
    has_reply: true,
    is_flagged: true,
  });
  expect(rows.find((row) => row.message_id === unrelated)).toMatchObject({
    has_reply: false,
    is_flagged: false,
  });
  const pin = await app.inject({
    method: 'POST',
    url: '/api/threads/' + visibleThread + '/pin',
    headers: { origin, cookie: cookies.get(user)! },
    payload: { scope: 'personal' },
  });
  expect(pin.statusCode, pin.body).toBe(200);
  expect((await list(search)).find((row) => row.id === visibleThread)).toMatchObject({
    is_pinned_personal: true,
    is_pinned_global: true,
  });
  expect((await list(search, other)).find((row) => row.id === visibleThread)).toMatchObject({
    is_pinned_personal: false,
    is_pinned_global: true,
  });
});

it('counts the readable conversation shown in detail even when replies are stored in Sent', async () => {
  const thread = randomUUID(),
    sentFolder = randomUUID();
  await db
    .insertInto('folders')
    .values({
      id: sentFolder,
      tenant_id: tenant,
      mailbox_id: box,
      name: 'Enviados contagem',
      imap_path: 'SentCount-' + sentFolder,
      special_use: 'sent',
      is_local: true,
    })
    .execute();
  await db
    .insertInto('threads')
    .values({
      id: thread,
      tenant_id: tenant,
      mailbox_id: box,
      subject: 'Contagem completa',
      subject_normalized: 'contagem completa',
    })
    .execute();
  await db
    .insertInto('messages')
    .values(
      Array.from({ length: 5 }, (_, index) => ({
        id: randomUUID(),
        tenant_id: tenant,
        mailbox_id: box,
        thread_id: thread,
        folder_id: index < 2 || index === 4 ? a : sentFolder,
        direction: index < 2 ? ('inbound' as const) : ('outbound' as const),
        subject: 'Contagem completa',
        message_id_header: '<' + randomUUID() + '@count.test>',
        message_at: new Date(Date.now() + index * 1000),
        source_kind: 'archive',
        deleted_at: index === 4 ? new Date() : null,
      })),
    )
    .execute();
  const get = async (path: string, who = user) => {
    const response = await app.inject({
      url: '/api' + path,
      headers: { origin, cookie: cookies.get(who)! },
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  };
  const detail = await get('/threads/' + thread);
  expect(detail.messages).toHaveLength(4);
  const folderPath = '/mailboxes/' + box + '/threads?folder_id=' + a;
  expect(
    (await get(folderPath)).items.find((item: { id: string }) => item.id === thread),
  ).toMatchObject({ message_count: detail.messages.length });
  const restricted = await get('/threads/' + thread, limited);
  expect(restricted.messages).toHaveLength(2);
  expect(
    (await get(folderPath, limited)).items.find((item: { id: string }) => item.id === thread),
  ).toMatchObject({ message_count: restricted.messages.length });
  const summary = await get('/mail-summary/threads?view=search');
  expect(summary.items.find((item: { id: string }) => item.id === thread)).toMatchObject({
    message_count: 4,
  });
  const sent = await get('/mailboxes/' + box + '/threads?folder_id=' + sentFolder);
  expect(sent.items).toHaveLength(2);
  expect(sent.items.every((item: { message_count: number }) => item.message_count === 1)).toBe(
    true,
  );
});
