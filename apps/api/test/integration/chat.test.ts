import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createDb, migrate } from '@apmail/db';
import type { ChatConversation, ChatMessage, SharedThreadSnapshot } from '@apmail/shared';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';
const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Banco exclusivo de testes obrigatório.');
const db = createDb(url),
  tenant = randomUUID(),
  foreignTenant = randomUUID(),
  a = randomUUID(),
  b = randomUUID(),
  c = randomUUID(),
  d = randomUUID(),
  foreign = randomUUID(),
  box = randomUUID(),
  thread = randomUUID(),
  folder = randomUUID();
const origin = 'http://localhost:5173',
  cookies = new Map<string, string>(),
  sockets: Socket[] = [];
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redisUrl,
    APP_URL: origin,
    SESSION_SECRET: randomBytes(32).toString('base64'),
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  }),
);
let address = '',
  direct = '',
  group = '';
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  user: string = a,
  payload?: unknown,
) =>
  app.inject({
    method,
    url: '/api/chat' + path,
    headers: {
      origin,
      cookie: cookies.get(user)!,
      ...(payload ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  });
const send = (
  id: string,
  user: string = a,
  body = 'Mensagem QA',
  client_id: string = randomUUID(),
) => call('POST', '/conversations/' + id + '/messages', user, { body, client_id });
const list = async (user: string = a) =>
  (await call('GET', '/conversations', user)).json<ChatConversation[]>();
async function connect(user: string) {
  const socket = io(address, {
    transports: ['websocket'],
    extraHeaders: { origin, cookie: cookies.get(user)! },
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Chat QA', slug: 'chat-' + tenant },
      { id: foreignTenant, name: 'Chat outra empresa', slug: 'chat-' + foreignTenant },
    ])
    .execute();
  for (const id of [a, b, c, d, foreign]) {
    const tid = id === foreign ? foreignTenant : tenant;
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@chat.test',
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
        role: id === a || id === foreign ? 'owner' : 'member',
      })
      .execute();
    await db
      .insertInto('user_preferences')
      .values({ user_id: id, notify_chat: id !== c })
      .execute();
    const token = randomBytes(32).toString('base64url');
    await db
      .insertInto('sessions')
      .values({
        token_hash: hashToken(token),
        user_id: id,
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
      name: 'Compartilhamento QA',
      email_address: 'qa@chat.test',
      imap_host: 'localhost',
      smtp_host: 'localhost',
      username: 'qa',
      status: 'disabled',
    })
    .execute();
  await db
    .insertInto('mailbox_members')
    .values({ tenant_id: tenant, mailbox_id: box, user_id: b, role: 'viewer' })
    .execute();
  await db
    .insertInto('folders')
    .values({
      id: folder,
      tenant_id: tenant,
      mailbox_id: box,
      imap_path: 'INBOX',
      name: 'INBOX',
      special_use: 'inbox',
    })
    .execute();
  await db
    .insertInto('threads')
    .values({ id: thread, tenant_id: tenant, mailbox_id: box, subject: 'Compartilhar e-mail' })
    .execute();
  await db
    .insertInto('messages')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      folder_id: folder,
      thread_id: thread,
      message_id_header: '<' + randomUUID() + '@chat.test>',
      subject: 'Compartilhar e-mail',
      from_address: 'cliente@chat.test',
      from_name: 'Cliente',
      snippet: 'Resumo seguro',
      message_at: new Date(),
      direction: 'inbound',
    })
    .execute();
  address = await app.listen({ port: 0, host: '127.0.0.1' });
}, 30000);
afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await app.close();
  await db.destroy();
});
it('diretas concorrentes convergem; grupos e participantes são isolados por tenant', async () => {
  const results = await Promise.all([
    call('POST', '/conversations/direct', a, { user_id: b }),
    call('POST', '/conversations/direct', b, { user_id: a }),
  ]);
  expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
  direct = results[0]!.json().id;
  expect(results[1]!.json().id).toBe(direct);
  expect((await list()).filter((x) => x.id === direct)).toHaveLength(1);
  expect((await call('POST', '/conversations/direct', a, { user_id: a })).statusCode).toBe(409);
  expect((await call('POST', '/conversations/direct', a, { user_id: foreign })).statusCode).toBe(
    409,
  );
  expect(
    (await call('POST', '/conversations/group', a, { name: 'Grupo inválido', user_ids: [b, b] }))
      .statusCode,
  ).toBe(409);
  const result = await call('POST', '/conversations/group', a, {
    name: 'Equipe QA',
    user_ids: [b, c, b],
  });
  expect(result.statusCode).toBe(200);
  group = result.json().id;
  expect((await list(b)).find((x) => x.id === group)?.participants).toHaveLength(3);
  expect((await call('GET', '/conversations/' + group + '/messages', foreign)).statusCode).toBe(
    404,
  );
  expect((await call('GET', '/conversations/' + group + '/messages', d)).statusCode).toBe(404);
  await expect(
    db
      .insertInto('chat_participants')
      .values({ tenant_id: foreignTenant, conversation_id: group, user_id: foreign })
      .execute(),
  ).rejects.toThrow();
}, 30000);
it('mensagens idempotentes emitem uma vez, não lidas e preferências conferem', async () => {
  const socket = await connect(b),
    events: ChatMessage[] = [];
  socket.on('chat:message', ({ message }: { message: ChatMessage }) => events.push(message));
  const key = randomUUID(),
    results = await Promise.all([
      send(direct, a, 'Olá <script>texto</script>', key),
      send(direct, a, 'Olá <script>texto</script>', key),
    ]);
  expect(results.map((r) => r.statusCode)).toEqual([200, 200]);
  expect(results[0]!.json().id).toBe(results[1]!.json().id);
  await new Promise((r) => setTimeout(r, 100));
  expect(events).toHaveLength(1);
  expect((await list(b)).find((x) => x.id === direct)?.unread_count).toBe(1);
  expect((await list(a)).find((x) => x.id === direct)?.unread_count).toBe(0);
  expect((await call('POST', '/conversations/' + direct + '/read', b)).statusCode).toBe(200);
  expect((await list(b)).find((x) => x.id === direct)?.unread_count).toBe(0);
  const before = await db
    .selectFrom('notifications')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', c)
    .execute();
  expect((await send(group)).statusCode).toBe(200);
  const after = await db
    .selectFrom('notifications')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', c)
    .execute();
  expect(after.length).toBe(before.length);
  const notices = await db
    .selectFrom('notifications')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', b)
    .where('type', '=', 'chat_message')
    .execute();
  expect(notices.filter((n) => n.link === '/chat/' + direct)).toHaveLength(1);
  expect((await send(group, a, 'Reuso indevido', key)).statusCode).toBe(409);
  expect((await send(group, a, ' '.repeat(5))).statusCode).toBe(400);
  expect((await send(group, a, 'x'.repeat(4001))).statusCode).toBe(400);
}, 30000);
it('grupo aceita nome e novos participantes; saída corta HTTP, salas e eventos', async () => {
  const sb = await connect(b),
    sc = await connect(c),
    sf = await connect(foreign);
  expect(await sb.timeout(5000).emitWithAck('chat:join', { conversation_id: group })).toEqual({
    ok: true,
  });
  expect(await sc.timeout(5000).emitWithAck('chat:join', { conversation_id: group })).toEqual({
    ok: true,
  });
  expect(await sf.timeout(5000).emitWithAck('chat:join', { conversation_id: group })).toEqual({
    error: 'forbidden',
  });
  const typing = new Promise<{ user_id: string }>((resolve) => sb.once('chat:typing', resolve));
  expect(await sc.timeout(5000).emitWithAck('chat:typing', { conversation_id: group })).toEqual({
    ok: true,
  });
  expect((await typing).user_id).toBe(c);
  expect(
    (await call('PATCH', '/conversations/' + group, b, { name: 'Grupo renomeado' })).statusCode,
  ).toBe(200);
  expect(
    (await call('POST', '/conversations/' + group + '/participants', b, { user_ids: [d] }))
      .statusCode,
  ).toBe(200);
  expect((await list(d)).find((x) => x.id === group)?.participants).toHaveLength(4);
  expect(
    (await call('POST', '/conversations/' + group + '/participants', b, { user_ids: [foreign] }))
      .statusCode,
  ).toBe(409);
  expect((await call('DELETE', '/conversations/' + group + '/participants/me', c)).statusCode).toBe(
    200,
  );
  const incoming: unknown[] = [];
  sc.on('chat:message', (value) => incoming.push(value));
  sc.on('chat:message-updated', (value) => incoming.push(value));
  expect((await send(group, c)).statusCode).toBe(404);
  expect((await call('GET', '/conversations/' + group + '/messages', c)).statusCode).toBe(404);
  expect(await sc.timeout(5000).emitWithAck('chat:typing', { conversation_id: group })).toEqual({
    error: 'forbidden',
  });
  const sent = await send(group, b);
  expect(sent.statusCode).toBe(200);
  expect(
    (await call('PATCH', '/messages/' + sent.json().id, b, { body: 'Alterada' })).statusCode,
  ).toBe(200);
  await new Promise((r) => setTimeout(r, 100));
  expect(incoming).toHaveLength(0);
  expect((await list(c)).some((x) => x.id === group)).toBe(false);
  expect(
    (await call('DELETE', '/conversations/' + direct + '/participants/me', b)).statusCode,
  ).toBe(403);
}, 30000);
it('paginação por data e ID não perde empates; edição e exclusão respeitam autor e prazo', async () => {
  const ids: string[] = Array.from({ length: 4 }, () => randomUUID()),
    at = new Date(Date.now() + 1000);
  await db
    .insertInto('chat_messages')
    .values(
      ids.map((id) => ({
        id,
        tenant_id: tenant,
        conversation_id: direct,
        sender_id: a,
        body: 'Cursor ' + id,
        created_at: at,
        client_id: randomUUID(),
      })),
    )
    .execute();
  const first = (await call('GET', '/conversations/' + direct + '/messages?limit=2', b)).json<
      ChatMessage[]
    >(),
    tail = first.at(-1)!;
  const next = (
    await call(
      'GET',
      '/conversations/' +
        direct +
        '/messages?limit=2&before=' +
        encodeURIComponent(tail.created_at) +
        '&before_id=' +
        tail.id,
      b,
    )
  ).json<ChatMessage[]>();
  expect(new Set([...first, ...next].map((m) => m.id)).size).toBe(4);
  expect([...first, ...next].every((m) => ids.includes(m.id))).toBe(true);
  const preciseIds: string[] = [randomUUID(), randomUUID()];
  await db
    .insertInto('chat_messages')
    .values(
      preciseIds.map((id, index) => ({
        id,
        tenant_id: tenant,
        conversation_id: direct,
        sender_id: a,
        body: 'Microssegundo',
        client_id: randomUUID(),
        created_at: at.toISOString().replace('Z', '00' + (index + 1) + 'Z'),
      })),
    )
    .execute();
  const preciseFirst = (await call('GET', '/conversations/' + direct + '/messages?limit=1')).json<
    ChatMessage[]
  >()[0]!;
  expect(preciseFirst.created_at).toMatch(/\.\d{6}Z$/);
  const preciseNext = (
    await call(
      'GET',
      '/conversations/' +
        direct +
        '/messages?limit=1&before=' +
        encodeURIComponent(preciseFirst.created_at) +
        '&before_id=' +
        preciseFirst.id,
    )
  ).json<ChatMessage[]>()[0]!;
  expect(new Set([preciseFirst.id, preciseNext.id])).toEqual(new Set(preciseIds));
  const result = await send(direct, a, 'Editável'),
    message = result.json<ChatMessage>();
  expect(
    (await call('PATCH', '/messages/' + message.id, b, { body: 'Não é minha' })).statusCode,
  ).toBe(403);
  const edited = await call('PATCH', '/messages/' + message.id, a, { body: 'Atualizada' });
  expect(edited.statusCode).toBe(200);
  expect(edited.json()).toMatchObject({ body: 'Atualizada', edited_at: expect.any(String) });
  expect((await call('DELETE', '/messages/' + message.id, a)).statusCode).toBe(200);
  const removed = (await call('GET', '/conversations/' + direct + '/messages'))
    .json<ChatMessage[]>()
    .find((m) => m.id === message.id)!;
  expect(removed).toMatchObject({
    body: '',
    shared_snapshot: null,
    deleted_at: expect.any(String),
  });
  const old = (await send(direct)).json<ChatMessage>();
  await db
    .updateTable('chat_messages')
    .set({ created_at: new Date(Date.now() - 901000) })
    .where('id', '=', old.id)
    .execute();
  expect(
    (await call('PATCH', '/messages/' + old.id, a, { body: 'Prazo encerrado' })).statusCode,
  ).toBe(409);
  expect((await call('DELETE', '/messages/' + old.id, a)).statusCode).toBe(409);
  expect(
    (await call('PATCH', '/messages/' + old.id, foreign, { body: 'Outra empresa' })).statusCode,
  ).toBe(404);
}, 30000);
it('compartilhamento é atômico e idempotente; snapshot não concede leitura da caixa', async () => {
  const id = randomUUID(),
    result = await call('POST', '/share-thread', a, {
      thread_id: thread,
      conversation_ids: [direct],
      user_ids: [c],
      comment: 'Verifique este e-mail',
      client_id: id,
    });
  expect(result.statusCode).toBe(200);
  const ids = result.json().conversation_ids as string[];
  expect(ids).toHaveLength(2);
  const shared = (await call('GET', '/conversations/' + direct + '/messages', b))
    .json<ChatMessage[]>()
    .find((m) => m.shared_thread_id === thread)!;
  expect(shared.shared_snapshot).toMatchObject({
    subject: 'Compartilhar e-mail',
    from_name: 'Cliente',
    snippet: 'Resumo seguro',
    mailbox_id: box,
    mailbox_name: 'Compartilhamento QA',
  } satisfies Partial<SharedThreadSnapshot>);
  expect((await call('GET', '/shared-threads/' + thread + '/access', b)).statusCode).toBe(200);
  expect((await call('GET', '/shared-threads/' + thread + '/access', c)).statusCode).toBe(404);
  const personal = ids.find((x) => x !== direct)!;
  expect((await list(c)).find((x) => x.id === personal)?.unread_count).toBe(1);
  expect(
    (
      await call('POST', '/share-thread', a, {
        thread_id: thread,
        conversation_ids: [direct],
        user_ids: [c],
        comment: 'Verifique este e-mail',
        client_id: id,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await call('GET', '/conversations/' + personal + '/messages', c))
      .json<ChatMessage[]>()
      .filter((m) => m.shared_thread_id === thread),
  ).toHaveLength(1);
  expect(
    (await call('POST', '/share-thread', c, { thread_id: thread, user_ids: [a] })).statusCode,
  ).toBe(404);
  const before = (await call('GET', '/conversations/' + direct + '/messages')).json<ChatMessage[]>()
    .length;
  expect(
    (
      await call('POST', '/share-thread', a, {
        thread_id: thread,
        conversation_ids: [direct, randomUUID()],
      })
    ).statusCode,
  ).toBe(404);
  expect((await call('GET', '/conversations/' + direct + '/messages')).json()).toHaveLength(before);
}, 30000);
it('presença considera abas e membros ativos; nova sessão não recupera acesso retirado', async () => {
  const first = await connect(d),
    second = await connect(d);
  for (let i = 0; i < 30; i++) {
    if ((await call('GET', '/presence')).json().online_user_ids.includes(d)) break;
    if (i === 29) throw Error('Presença não chegou');
    await new Promise((r) => setTimeout(r, 100));
  }
  first.disconnect();
  expect((await call('GET', '/presence')).json().online_user_ids).toContain(d);
  second.disconnect();
  for (let i = 0; i < 30; i++) {
    if (!(await call('GET', '/presence')).json().online_user_ids.includes(d)) break;
    if (i === 29) throw Error('Presença não saiu');
    await new Promise((r) => setTimeout(r, 100));
  }
  await db
    .updateTable('tenant_members')
    .set({ status: 'disabled' })
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', d)
    .execute();
  expect((await call('POST', '/conversations/direct', a, { user_id: d })).statusCode).toBe(409);
  expect((await call('GET', '/conversations/' + group + '/messages', d)).statusCode).toBe(409);
}, 30000);
