import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { io, type Socket } from 'socket.io-client';
import { createDb, migrate, touchThreads } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';
const url = process.env.DATABASE_URL_TEST!,
  redis = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('TEST obrigatório');
const db = createDb(url),
  tenant = randomUUID(),
  foreignTenant = randomUUID(),
  owner = randomUUID(),
  editor = randomUUID(),
  viewer = randomUUID(),
  admin = randomUUID(),
  foreign = randomUUID(),
  box = randomUUID(),
  clients = randomUUID(),
  child = randomUUID(),
  secret = randomUUID(),
  mixed = randomUUID(),
  hidden = randomUUID(),
  visible = randomUUID(),
  allowedMessage = randomUUID(),
  secretMessage = randomUUID(),
  attachment = randomUUID(),
  cookies = new Map<string, string>(),
  origin = 'http://localhost:5173',
  sockets: Socket[] = [];
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
let address = '';
vi.setConfig({ testTimeout: 30000 });
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  user = editor,
  payload?: unknown,
) =>
  app.inject({
    method,
    url: '/api' + path,
    headers: {
      origin,
      cookie: cookies.get(user)!,
      ...(payload ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  });
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Pastas QA', slug: 'folders-' + tenant },
      { id: foreignTenant, name: 'Outro tenant', slug: 'folders-' + foreignTenant },
    ])
    .execute();
  for (const id of [owner, editor, viewer, admin, foreign]) {
    const tid = id === foreign ? foreignTenant : tenant;
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@folders.test',
        full_name: 'Pessoa ' + id,
        password_hash: 'session-fixture',
        current_tenant_id: tid,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({
        tenant_id: tid,
        user_id: id,
        role: id === owner || id === foreign ? 'owner' : 'member',
      })
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
  await db
    .insertInto('mailboxes')
    .values({
      id: box,
      tenant_id: tenant,
      name: 'Pasta QA',
      email_address: 'qa@folders.test',
      imap_host: 'localhost',
      smtp_host: 'localhost',
      username: 'qa',
      status: 'disabled',
    })
    .execute();
  for (const id of [editor, viewer, admin])
    await db
      .insertInto('mailbox_members')
      .values({
        tenant_id: tenant,
        mailbox_id: box,
        user_id: id,
        role: id === admin ? 'mailbox_admin' : id === viewer ? 'viewer' : 'editor',
        restrict_to_folders: id !== admin,
      })
      .execute();
  await db
    .insertInto('folders')
    .values([
      { id: clients, tenant_id: tenant, mailbox_id: box, name: 'Clientes', imap_path: 'Clientes' },
      {
        id: child,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'Projeto',
        imap_path: 'Clientes.Projeto',
        parent_id: clients,
      },
      {
        id: secret,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'Confidencial',
        imap_path: 'INBOX',
        special_use: 'inbox',
      },
    ])
    .execute();
  for (const id of [editor, viewer])
    await db
      .insertInto('folder_permissions')
      .values({ tenant_id: tenant, mailbox_id: box, user_id: id, folder_id: clients })
      .execute();
  await db
    .insertInto('threads')
    .values(
      [mixed, hidden, visible].map((id) => ({
        id,
        tenant_id: tenant,
        mailbox_id: box,
        subject: 'Segredo interno',
      })),
    )
    .execute();
  const message = (
    id: string,
    thread_id: string,
    folder_id: string,
    body: string,
    time: number,
  ) => ({
    id,
    tenant_id: tenant,
    mailbox_id: box,
    thread_id,
    folder_id,
    message_id_header: '<' + id + '@folders.test>',
    subject: body,
    body_text: body,
    snippet: body,
    from_address: body === 'Segredo interno' ? 'confidencial@folders.test' : 'cliente@folders.test',
    message_at: new Date(Date.now() + time),
    direction: 'inbound' as const,
    has_attachments: folder_id === secret,
  });
  await db
    .insertInto('messages')
    .values([
      message(allowedMessage, mixed, child, 'Atendimento permitido', -60000),
      message(secretMessage, mixed, secret, 'Segredo interno', 0),
      message(randomUUID(), hidden, secret, 'Segredo interno', 0),
      message(randomUUID(), visible, clients, 'Cliente permitido', 0),
    ])
    .execute();
  await db
    .insertInto('attachments')
    .values({
      id: attachment,
      tenant_id: tenant,
      mailbox_id: box,
      message_id: secretMessage,
      filename: 'segredo.pdf',
      content_type: 'application/pdf',
      size_bytes: 10,
      storage_path: 'fixture-never-read',
    })
    .execute();
  await touchThreads(db, [mixed, hidden, visible], 'sync', null);
  address = await app.listen({ host: '127.0.0.1', port: 0 });
}, 30000);
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await app.close();
  await db.destroy();
});
it('Resumo agrega somente caixas e pastas autorizadas, com total, origem e paginação SQL', async () => {
  const secondBox = randomUUID(),
    inaccessibleBox = randomUUID(),
    foreignBox = randomUUID();
  const secondFolder = randomUUID(),
    inaccessibleFolder = randomUUID(),
    foreignFolder = randomUUID();
  const secondThreads = Array.from({ length: 10 }, () => randomUUID());
  const inaccessibleThread = randomUUID(),
    foreignThread = randomUUID();
  await db
    .insertInto('mailboxes')
    .values([
      {
        id: secondBox,
        tenant_id: tenant,
        name: 'Segunda caixa',
        email_address: 'second@folders.test',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        username: 'second',
        status: 'disabled',
      },
      {
        id: inaccessibleBox,
        tenant_id: tenant,
        name: 'Caixa restrita',
        email_address: 'restricted@folders.test',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        username: 'restricted',
        status: 'disabled',
      },
      {
        id: foreignBox,
        tenant_id: foreignTenant,
        name: 'Caixa externa',
        email_address: 'foreign@folders.test',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        username: 'foreign',
        status: 'disabled',
      },
    ])
    .execute();
  await db
    .insertInto('mailbox_members')
    .values({ tenant_id: tenant, mailbox_id: secondBox, user_id: editor, role: 'viewer' })
    .execute();
  await db
    .insertInto('folders')
    .values([
      {
        id: secondFolder,
        tenant_id: tenant,
        mailbox_id: secondBox,
        name: 'Entrada',
        imap_path: 'INBOX',
        special_use: 'inbox',
      },
      {
        id: inaccessibleFolder,
        tenant_id: tenant,
        mailbox_id: inaccessibleBox,
        name: 'Entrada',
        imap_path: 'INBOX',
        special_use: 'inbox',
      },
      {
        id: foreignFolder,
        tenant_id: foreignTenant,
        mailbox_id: foreignBox,
        name: 'Entrada',
        imap_path: 'INBOX',
        special_use: 'inbox',
      },
    ])
    .execute();
  const samples = [
    ...secondThreads.map((id, index) => ({
      id,
      tid: tenant,
      boxId: secondBox,
      folder: secondFolder,
      subject: 'Segunda caixa ' + index,
    })),
    {
      id: inaccessibleThread,
      tid: tenant,
      boxId: inaccessibleBox,
      folder: inaccessibleFolder,
      subject: 'Caixa sem acesso',
    },
    {
      id: foreignThread,
      tid: foreignTenant,
      boxId: foreignBox,
      folder: foreignFolder,
      subject: 'Mensagem de outra empresa',
    },
  ];
  await db
    .insertInto('threads')
    .values(
      samples.map((sample) => ({
        id: sample.id,
        tenant_id: sample.tid,
        mailbox_id: sample.boxId,
        subject: sample.subject,
      })),
    )
    .execute();
  const timestamp = Date.now();
  await db
    .insertInto('messages')
    .values(
      samples.map((sample, index) => ({
        id: randomUUID(),
        tenant_id: sample.tid,
        mailbox_id: sample.boxId,
        thread_id: sample.id,
        folder_id: sample.folder,
        message_id_header: '<' + sample.id + '@summary.test>',
        subject: sample.subject,
        body_text: sample.subject,
        snippet: sample.subject,
        from_address: 'summary@folders.test',
        direction: 'inbound' as const,
        message_at: new Date(timestamp + (index + 1) * 1000),
      })),
    )
    .execute();
  await touchThreads(
    db,
    samples.map((sample) => sample.id),
    'sync',
    null,
  );
  const response = await call('GET', '/mail-summary/threads?view=search&page_size=20&sort=recent');
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().total).toBe(12);
  expect(response.json().items).toHaveLength(12);
  expect(response.json().page_size).toBe(20);
  expect(
    response
      .json()
      .items.slice(0, 10)
      .map((item: { id: string }) => item.id),
  ).toEqual([...secondThreads].reverse());
  expect(response.json().items[0]).toMatchObject({
    mailbox_id: secondBox,
    mailbox_name: 'Segunda caixa',
    mailbox_email: 'second@folders.test',
  });
  expect(response.json().items[10]).toMatchObject({
    id: visible,
    mailbox_id: box,
    mailbox_name: 'Pasta QA',
  });
  expect(response.json().items[11].id).toBe(mixed);
  expect(JSON.stringify(response.json())).not.toContain('Segredo interno');
  expect(response.body).not.toContain('Caixa sem acesso');
  expect(response.body).not.toContain('Mensagem de outra empresa');
  const page = await call(
    'GET',
    '/mail-summary/threads?view=search&page_size=10&page=2&sort=recent',
  );
  expect(page.statusCode, page.body).toBe(200);
  expect(page.json()).toMatchObject({ total: 12, page: 2, page_size: 10 });
  expect(page.json().items.map((item: { id: string }) => item.id)).toEqual([visible, mixed]);
  const oldest = await call('GET', '/mail-summary/threads?view=search&page_size=10&sort=oldest');
  expect(
    oldest
      .json()
      .items.slice(0, 3)
      .map((item: { id: string }) => item.id),
  ).toEqual([mixed, visible, secondThreads[0]]);
  const counts = await call('GET', '/mail-summary/queue-counts');
  expect(counts.statusCode, counts.body).toBe(200);
  expect(counts.json()).toMatchObject({ to_reply: 12, unread_inbox: 10 });
  const foreignResult = await call('GET', '/mail-summary/threads?view=search', foreign);
  expect(foreignResult.json().items.map((item: { id: string }) => item.id)).toEqual([
    foreignThread,
  ]);
  expect(foreignResult.body).not.toContain('Atendimento permitido');
  const individual = await call('GET', '/mailboxes/' + box + '/threads?view=search');
  expect(individual.json().total).toBe(2);
  try {
    await db
      .updateTable('tenant_members')
      .set({ custom_permissions: ['mail'] })
      .where('tenant_id', '=', tenant)
      .where('user_id', '=', editor)
      .execute();
    const custom = await call('GET', '/mail-summary/threads?view=search');
    expect(custom.statusCode, custom.body).toBe(200);
    expect(custom.json().total).toBe(12);
    expect((await call('GET', '/mail-summary/queue-counts')).statusCode).toBe(200);
    await db
      .updateTable('tenant_members')
      .set({ custom_permissions: [] })
      .where('tenant_id', '=', tenant)
      .where('user_id', '=', editor)
      .execute();
    expect((await call('GET', '/mail-summary/threads?view=search')).statusCode).toBe(403);
  } finally {
    await db
      .updateTable('tenant_members')
      .set({ custom_permissions: null })
      .where('tenant_id', '=', tenant)
      .where('user_id', '=', editor)
      .execute();
  }
});
it('PDF inclui a conversa legível completa sem revelar assunto ou anexos de pasta restrita', async () => {
  const pdfText = (buffer: Buffer) =>
    [...buffer.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)]
      .map((match) => {
        try {
          return [
            ...inflateSync(Buffer.from(match[1]!, 'latin1'))
              .toString('latin1')
              .matchAll(/<([0-9a-f]+)>/gi),
          ]
            .map((hex) => Buffer.from(hex[1]!, 'hex').toString('latin1'))
            .join('');
        } catch {
          return '';
        }
      })
      .join('\n');
  const restricted = await call(
    'GET',
    '/threads/' + mixed + '/pdf?message_id=' + secretMessage + '&folder_id=' + secret,
  );
  expect(restricted.statusCode, restricted.body).toBe(200);
  expect(restricted.headers['content-type']).toContain('application/pdf');
  expect(restricted.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  expect(restricted.rawPayload.toString('latin1')).not.toContain('Segredo interno');
  expect(pdfText(restricted.rawPayload)).toContain('Atendimento permitido');
  expect(pdfText(restricted.rawPayload)).not.toContain('confidencial@folders.test');
  expect(pdfText(restricted.rawPayload)).not.toContain('segredo.pdf');
  expect((await call('GET', '/threads/' + hidden + '/pdf')).statusCode).toBe(404);
  expect((await call('GET', '/threads/' + mixed + '/pdf', foreign)).statusCode).toBe(404);
  const complete = await call(
    'GET',
    '/threads/' + mixed + '/pdf?message_id=' + allowedMessage,
    owner,
  );
  expect(complete.statusCode).toBe(200);
  expect(pdfText(complete.rawPayload)).toContain('Segredo interno');
  expect(pdfText(complete.rawPayload)).toContain('segredo.pdf');
  expect(complete.rawPayload.length).toBeGreaterThan(restricted.rawPayload.length);
});
it('árvore herdada, listagem e busca calculam somente mensagens legíveis', async () => {
  const folders = (await call('GET', '/mailboxes/' + box + '/folders')).json();
  expect(folders).toHaveLength(1);
  expect(folders[0].id).toBe(clients);
  expect(folders[0].children[0].id).toBe(child);
  const result = await call('GET', '/mailboxes/' + box + '/threads?view=search');
  expect(result.statusCode, result.body).toBe(200);
  const list = result.json();
  expect(list.total).toBe(2);
  const thread = list.items.find((t: { id: string }) => t.id === mixed);
  expect(thread).toMatchObject({
    subject: 'Atendimento permitido',
    snippet: 'Atendimento permitido',
    message_count: 1,
    has_attachments: false,
    participants: ['cliente@folders.test'],
  });
  expect(
    (await call('GET', '/mailboxes/' + box + '/threads?view=search&q=segredo')).json().total,
  ).toBe(0);
  expect(
    (await call('GET', '/mailboxes/' + box + '/threads?view=search&q=atendimento')).json().total,
  ).toBe(1);
  expect(
    (await call('GET', '/mailboxes/' + box + '/threads?view=folder&folder_id=' + secret))
      .statusCode,
  ).toBe(404);
  expect((await call('GET', '/mailboxes/' + box + '/queue-counts')).json()).toMatchObject({
    to_reply: 2,
    unread_inbox: 0,
  });
  expect(
    (await call('GET', '/mailboxes/' + box + '/address-suggestions?q=confidencial')).json(),
  ).toEqual([]);
  expect(
    (await call('GET', '/mailboxes/' + box + '/address-suggestions?q=cliente')).json(),
  ).toHaveLength(1);
});
it('URL direta, anexos, resposta, compartilhamento e dashboard negam acesso indevido', async () => {
  const detail = (await call('GET', '/threads/' + mixed)).json();
  expect(detail.messages).toHaveLength(1);
  expect(detail.thread).toMatchObject({
    subject: 'Atendimento permitido',
    message_count: 1,
    has_attachments: false,
    participants: ['cliente@folders.test'],
  });
  expect(JSON.stringify(detail)).not.toContain('Segredo interno');
  for (const user of [editor, viewer]) {
    for (const path of [
      '/threads/' + hidden,
      '/attachments/' + attachment + '/download',
      '/attachments/' + attachment + '/inline',
      '/chat/shared-threads/' + hidden + '/access',
    ])
      expect((await call('GET', path, user)).statusCode).toBe(404);
    const dashboard = await call('GET', '/dashboard/kpis?mailbox_id=' + box, user);
    expect(dashboard.statusCode).toBe(200);
    expect(
      (await call('GET', '/dashboard/stale-threads?mailbox_id=' + box, user)).body,
    ).not.toContain('Segredo interno');
    expect(dashboard.json()).toMatchObject({ received: 0, sent: 0 });
  }
  expect(
    (
      await call('POST', '/outbox', editor, {
        mailbox_id: box,
        kind: 'reply',
        thread_id: mixed,
        reply_to_message_id: secretMessage,
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call('POST', '/outbox', editor, {
        mailbox_id: box,
        attachments: [{ source: 'message_attachment', attachment_id: attachment }],
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call('POST', '/mailboxes/' + box + '/threads/bulk', editor, {
        thread_ids: [mixed, hidden],
        action: 'read',
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call('POST', '/chat/share-thread', editor, {
        thread_id: hidden,
        user_ids: [owner],
        conversation_ids: [],
      })
    ).statusCode,
  ).toBe(404);
  const shared = await call('POST', '/chat/share-thread', editor, {
    thread_id: mixed,
    user_ids: [owner],
    conversation_ids: [],
  });
  expect(shared.statusCode, shared.body).toBe(200);
  const cc = await db
    .selectFrom('chat_conversations')
    .select('id')
    .where('tenant_id', '=', tenant)
    .executeTakeFirstOrThrow();
  const msg = await db
    .selectFrom('chat_messages')
    .select('shared_snapshot')
    .where('conversation_id', '=', cc.id)
    .executeTakeFirstOrThrow();
  expect(msg.shared_snapshot).toMatchObject({
    subject: 'Atendimento permitido',
    snippet: 'Atendimento permitido',
  });
});
it('admins não são restritos e permissões de outra empresa/pasta são rejeitadas atomicamente', async () => {
  expect((await call('GET', '/health/queues', editor)).statusCode).toBe(403);
  const health = await call('GET', '/health/queues', owner);
  expect(health.statusCode, health.body).toBe(200);
  expect(health.json().queues['mailbox-sync']).toEqual(
    expect.objectContaining({ waiting: expect.any(Number), failed: expect.any(Number) }),
  );
  expect(health.headers['x-request-id']).toBeTruthy();
  for (const user of [owner, admin]) {
    expect((await call('GET', '/threads/' + hidden, user)).statusCode).toBe(200);
    expect(
      (await call('GET', '/mailboxes/' + box + '/threads?view=search&q=segredo', user)).json()
        .total,
    ).toBe(2);
  }
  expect((await call('GET', '/threads/' + mixed, foreign)).statusCode).toBe(404);
  expect(
    (
      await call('PUT', '/mailboxes/' + box + '/members/' + viewer, editor, {
        role: 'viewer',
        restrict_to_folders: true,
        folder_ids: [clients],
      })
    ).statusCode,
  ).toBe(403);
  const bad = await call('PUT', '/members/' + viewer + '/access', owner, {
    tenant_role: 'member',
    mailbox_roles: [
      { mailbox_id: box, role: 'editor', restrict_to_folders: true, folder_ids: [randomUUID()] },
    ],
  });
  expect(bad.statusCode).toBe(404);
  expect(
    (
      await db
        .selectFrom('mailbox_members')
        .select('role')
        .where('user_id', '=', viewer)
        .where('mailbox_id', '=', box)
        .executeTakeFirstOrThrow()
    ).role,
  ).toBe('viewer');
  expect(
    (
      await call('PUT', '/mailboxes/' + box + '/members/' + viewer, owner, {
        role: 'mailbox_admin',
        restrict_to_folders: true,
        folder_ids: [clients],
      })
    ).statusCode,
  ).toBe(400);
});
it('auditoria combina filtros, busca por rótulo e remove segredos de registros históricos', async () => {
  const { id } = await db
    .insertInto('audit_logs')
    .values({
      tenant_id: tenant,
      actor_id: editor,
      action: 'mailbox_member.updated',
      entity_type: 'mailbox',
      entity_id: box,
      metadata: JSON.stringify({
        role: 'editor',
        password: 'SEGREDO-QA',
        nested: { access_token: 'TOKEN-QA', count: 2 },
      }),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const result = await call(
    'GET',
    '/audit-logs?actor_ids=' +
      editor +
      ',' +
      viewer +
      '&actions=mailbox_member.updated&from=' +
      encodeURIComponent(new Date(Date.now() - 60000).toISOString()) +
      '&to=' +
      encodeURIComponent(new Date(Date.now() + 60000).toISOString()),
    owner,
  );
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().items.find((item: { id: string }) => item.id === id)?.metadata).toEqual({
    role: 'editor',
    nested: { count: 2 },
  });
  expect(result.body).not.toContain('SEGREDO-QA');
  expect(result.body).not.toContain('TOKEN-QA');
  expect((await call('GET', '/audit-logs?actor_ids=invalid', owner)).statusCode).toBe(400);
  expect((await call('GET', '/audit-logs', viewer)).statusCode).toBe(403);
});
it('sala HTTP/socket é revogada imediatamente ao mudar a restrição e vazio nega todas as pastas', async () => {
  const s = io(address, {
    transports: ['websocket'],
    extraHeaders: { origin, cookie: cookies.get(viewer)! },
  });
  sockets.push(s);
  await new Promise<void>((resolve, reject) => {
    s.once('connect', resolve);
    s.once('connect_error', reject);
  });
  expect(await s.emitWithAck('thread:join', { thread_id: hidden })).toEqual({ error: 'forbidden' });
  expect(await s.emitWithAck('thread:subscribe', { thread_id: hidden })).toEqual({ ok: false });
  expect(await s.emitWithAck('thread:join', { thread_id: mixed })).toEqual({ ok: true });
  const revoke = await call('PUT', '/mailboxes/' + box + '/members/' + viewer, owner, {
    role: 'viewer',
    restrict_to_folders: true,
    folder_ids: [],
  });
  expect(revoke.statusCode, revoke.body).toBe(200);
  expect((await call('GET', '/threads/' + mixed, viewer)).statusCode).toBe(404);
  expect(
    (await call('GET', '/mailboxes/' + box + '/threads?view=search', viewer)).json().total,
  ).toBe(0);
  expect(await s.emitWithAck('thread:join', { thread_id: mixed })).toEqual({ error: 'forbidden' });
  const events: unknown[] = [];
  s.on('thread:messages-changed', (event) => events.push(event));
  expect((await call('POST', '/threads/' + mixed + '/done', owner)).statusCode).toBe(200);
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(events).toHaveLength(0);
});
it('encerrar outra instância da API preserva os sockets locais desta instância', async () => {
  const socket = io(address, {
    transports: ['websocket'],
    extraHeaders: { origin, cookie: cookies.get(owner)! },
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const other = await buildApp(
    envSchema.parse({
      NODE_ENV: 'test',
      DATABASE_URL: url,
      REDIS_URL: redis,
      APP_URL: origin,
      SESSION_SECRET: randomBytes(32).toString('base64'),
      CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    }),
  );
  await other.ready();
  await other.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(socket.connected).toBe(true);
  expect(await socket.timeout(3000).emitWithAck('thread:join', { thread_id: mixed })).toEqual({
    ok: true,
  });
});
