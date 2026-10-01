import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { io, type Socket } from 'socket.io-client';
import { createDb, migrate, touchThreads, asJson } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';
const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Banco exclusivo de testes obrigatório.');
const db = createDb(url),
  tenant = randomUUID(),
  box = randomUUID(),
  owner = randomUUID(),
  editor = randomUUID(),
  viewer = randomUUID(),
  outsider = randomUUID(),
  folder = randomUUID(),
  thread = randomUUID(),
  origin = 'http://localhost:5173';
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
const cookies = new Map<string, string>();
let address = '';
const sockets: Socket[] = [];
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  user: string = owner,
  payload?: unknown,
) =>
  app.inject({
    method,
    url: path,
    headers: {
      origin,
      cookie: cookies.get(user)!,
      ...(payload ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  });
async function message(
  direction: 'inbound' | 'outbound',
  at: Date,
  automated = false,
  id: string = thread,
) {
  await db
    .insertInto('messages')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      folder_id: folder,
      thread_id: id,
      message_id_header: '<' + randomUUID() + '@test>',
      subject: 'Filas QA',
      from_address: direction === 'inbound' ? 'cliente@cliente.local' : 'caixa@apmail.local',
      message_at: at,
      direction,
      is_automated: automated,
    })
    .execute();
  await db.transaction().execute((tx) => touchThreads(tx, [id], direction, null));
}
const get = () =>
  db.selectFrom('threads').selectAll().where('id', '=', thread).executeTakeFirstOrThrow();
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values({
      id: tenant,
      name: 'Filas QA',
      slug: 'queues-' + tenant,
      settings: asJson({ sla_first_response_hours: 1 }),
    })
    .execute();
  for (const [id, role] of [
    [owner, 'owner'],
    [editor, 'member'],
    [viewer, 'member'],
    [outsider, 'member'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@apmail.local',
        full_name: id === viewer ? 'Leitor QA' : id === editor ? 'Editor QA' : 'Usuário QA',
        password_hash: 'session-fixture',
        current_tenant_id: tenant,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tenant, user_id: id, role })
      .execute();
    await db.insertInto('user_preferences').values({ user_id: id }).execute();
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
      name: 'Caixa QA',
      email_address: 'caixa@apmail.local',
      username: 'qa',
      imap_host: 'localhost',
      smtp_host: 'localhost',
      status: 'disabled',
    })
    .execute();
  await db
    .insertInto('mailbox_members')
    .values([
      { tenant_id: tenant, mailbox_id: box, user_id: editor, role: 'editor' },
      { tenant_id: tenant, mailbox_id: box, user_id: viewer, role: 'viewer' },
    ])
    .execute();
  await db
    .insertInto('folders')
    .values({
      id: folder,
      tenant_id: tenant,
      mailbox_id: box,
      name: 'INBOX',
      imap_path: 'INBOX',
      special_use: 'inbox',
    })
    .execute();
  await db
    .insertInto('threads')
    .values({ id: thread, tenant_id: tenant, mailbox_id: box })
    .execute();
  address = await app.listen({ port: 0, host: '127.0.0.1' });
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await app.close();
  await db.destroy();
});
it('transições preservam atribuição, cancelamento, reabertura e histórico idempotente', async () => {
  const start = new Date(Date.now() - 10800000);
  await message('inbound', start);
  expect((await get()).queue_status).toBe('to_reply');
  expect(
    (await call('PUT', '/api/threads/' + thread + '/assignee', editor, { user_id: editor }))
      .statusCode,
  ).toBe(200);
  expect((await get()).queue_status).toBe('in_progress');
  expect(
    (await call('PUT', '/api/threads/' + thread + '/assignee', editor, { user_id: owner }))
      .statusCode,
  ).toBe(403);
  expect(
    (await call('PUT', '/api/threads/' + thread + '/assignee', owner, { user_id: viewer }))
      .statusCode,
  ).toBe(409);
  expect((await call('POST', '/api/threads/' + thread + '/done', viewer)).statusCode).toBe(403);
  const outbox = await db
    .insertInto('outbox')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      thread_id: thread,
      created_by: editor,
      status: 'scheduled',
      scheduled_at: new Date(Date.now() + 3600000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db.transaction().execute((tx) => touchThreads(tx, [thread], 'schedule', editor));
  expect((await get()).queue_status).toBe('scheduled');
  await db.updateTable('outbox').set({ status: 'canceled' }).where('id', '=', outbox.id).execute();
  await db.transaction().execute((tx) => touchThreads(tx, [thread], 'schedule', editor));
  expect((await get()).queue_status).toBe('in_progress');
  await db.updateTable('outbox').set({ status: 'sent' }).where('id', '=', outbox.id).execute();
  await message('outbound', new Date(start.getTime() + 3600000));
  expect((await get()).queue_status).toBe('awaiting_reply');
  await message('inbound', new Date(start.getTime() + 7200000));
  expect((await get()).queue_status).toBe('in_progress');
  await call('POST', '/api/threads/' + thread + '/done', editor);
  expect((await get()).queue_status).toBe('done');
  await message('inbound', new Date(Date.now() + 1000));
  expect((await get()).queue_status).toBe('in_progress');
  expect((await get()).manual_done_at).toBeNull();
  await call('PUT', '/api/threads/' + thread + '/queue-excluded', editor, { excluded: true });
  expect((await get()).queue_status).toBe('none');
  await call('POST', '/api/threads/' + thread + '/reopen', editor);
  expect((await get()).queue_status).toBe('in_progress');
  const historyBefore = await db
    .selectFrom('thread_status_history')
    .select('id')
    .where('thread_id', '=', thread)
    .execute();
  await db.transaction().execute((tx) => touchThreads(tx, [thread], 'sync', null));
  expect(
    await db
      .selectFrom('thread_status_history')
      .select('id')
      .where('thread_id', '=', thread)
      .execute(),
  ).toHaveLength(historyBefore.length);
  const history = (await call('GET', '/api/threads/' + thread + '/history', viewer)).json();
  expect(
    history.some(
      (h: { type: string; to_status: string }) => h.type === 'status' && h.to_status === 'done',
    ),
  ).toBe(true);
  expect(history.some((h: { type: string }) => h.type === 'assignment')).toBe(true);
  const auto = await db
    .insertInto('threads')
    .values({ tenant_id: tenant, mailbox_id: box })
    .returning('id')
    .executeTakeFirstOrThrow();
  await message('inbound', new Date(), true, auto.id);
  expect(
    (await db.selectFrom('threads').selectAll().where('id', '=', auto.id).executeTakeFirstOrThrow())
      .queue_status,
  ).toBe('none');
}, 30000);
it('SLA e lote atômico respeitam acesso e preferências de atribuição', async () => {
  const t2 = await db
    .insertInto('threads')
    .values({ tenant_id: tenant, mailbox_id: box })
    .returning('id')
    .executeTakeFirstOrThrow();
  await message('inbound', new Date(Date.now() - 7200000), false, t2.id);
  expect(
    (await call('GET', '/api/mailboxes/' + box + '/queue-counts', viewer)).json().overdue,
  ).toBe(1);
  const overdue = (
    await call('GET', '/api/mailboxes/' + box + '/threads?view=queue&queue=overdue', viewer)
  ).json();
  expect(overdue.items.map((t: { id: string }) => t.id)).toContain(t2.id);
  expect(
    (
      await call('POST', '/api/mailboxes/' + box + '/threads/bulk', editor, {
        thread_ids: [thread, t2.id],
        action: 'assign',
        user_id: editor,
      })
    ).json().updated,
  ).toBe(2);
  expect(
    (
      await call('POST', '/api/mailboxes/' + box + '/threads/bulk', editor, {
        thread_ids: [thread, randomUUID()],
        action: 'done',
      })
    ).statusCode,
  ).toBe(404);
  expect((await get()).queue_status).toBe('in_progress');
  await call('PUT', '/api/threads/' + thread + '/assignee', owner, { user_id: null });
  await call('PUT', '/api/threads/' + thread + '/assignee', owner, { user_id: editor });
  expect(
    await db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', editor)
      .where('type', '=', 'assignment')
      .execute(),
  ).toHaveLength(1);
  await db
    .updateTable('user_preferences')
    .set({ notify_assignments: false })
    .where('user_id', '=', editor)
    .execute();
  await call('PUT', '/api/threads/' + thread + '/assignee', owner, { user_id: null });
  await call('PUT', '/api/threads/' + thread + '/assignee', owner, { user_id: editor });
  expect(
    await db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', editor)
      .where('type', '=', 'assignment')
      .execute(),
  ).toHaveLength(1);
  expect((await call('GET', '/api/threads/' + thread + '/history', outsider)).statusCode).toBe(404);
}, 30000);
it('notas filtram menções e impõem autoria e limite de 15 minutos', async () => {
  const body = `Ajuda @[Leitor QA](${viewer}) e @[Sem acesso](${outsider})`,
    created = await call('POST', '/api/threads/' + thread + '/notes', editor, {
      body,
      mentioned_user_ids: [viewer, outsider, owner],
    });
  expect(created.statusCode).toBe(201);
  const note = created.json();
  expect(note.mentioned_user_ids).toEqual([viewer]);
  expect(
    await db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', viewer)
      .where('type', '=', 'mention')
      .execute(),
  ).toHaveLength(1);
  expect((await call('GET', '/api/threads/' + thread + '/notes', viewer)).json()).toHaveLength(1);
  expect(
    (await call('POST', '/api/threads/' + thread + '/notes', viewer, { body: 'Não permitido' }))
      .statusCode,
  ).toBe(403);
  expect(
    (await call('PATCH', '/api/notes/' + note.id, owner, { body: 'Outro autor' })).statusCode,
  ).toBe(403);
  expect(
    (await call('PATCH', '/api/notes/' + note.id, editor, { body: body + ' editada' })).statusCode,
  ).toBe(200);
  expect(
    await db
      .selectFrom('notifications')
      .selectAll()
      .where('user_id', '=', viewer)
      .where('type', '=', 'mention')
      .execute(),
  ).toHaveLength(1);
  await db
    .updateTable('thread_notes')
    .set({ created_at: new Date(Date.now() - 901000) })
    .where('id', '=', note.id)
    .execute();
  expect((await call('DELETE', '/api/notes/' + note.id, editor)).statusCode).toBe(403);
  const second = (
    await call('POST', '/api/threads/' + thread + '/notes', editor, { body: 'Descartável' })
  ).json();
  expect((await call('DELETE', '/api/notes/' + second.id, editor)).statusCode).toBe(200);
  expect((await call('GET', '/api/threads/' + thread + '/notes', viewer)).json()).toHaveLength(1);
}, 30000);
it('salas e composição validam cada evento e removem presença ao fechar', async () => {
  const connect = async (user: string) => {
    const s = io(address, {
      transports: ['websocket'],
      extraHeaders: { origin, cookie: cookies.get(user)! },
    });
    sockets.push(s);
    await new Promise<void>((resolve, reject) => {
      s.once('connect', resolve);
      s.once('connect_error', reject);
    });
    return s;
  };
  const a = await connect(editor),
    b = await connect(viewer),
    o = await connect(outsider);
  expect(await b.timeout(3000).emitWithAck('thread:join', { thread_id: thread })).toEqual({
    ok: true,
  });
  const rapid = [
    b.timeout(3000).emitWithAck('thread:join', { thread_id: thread }),
    b.timeout(3000).emitWithAck('thread:leave', { thread_id: thread }),
    b.timeout(3000).emitWithAck('thread:join', { thread_id: thread }),
  ];
  expect(await Promise.all(rapid)).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
  expect(await o.timeout(3000).emitWithAck('thread:join', { thread_id: thread })).toEqual({
    error: 'forbidden',
  });
  const presence = new Promise<{ users: { user_id: string }[] }>((resolve) =>
    b.once('thread:presence', resolve),
  );
  expect(
    await a.timeout(3000).emitWithAck('thread:composing', { thread_id: thread, composing: true }),
  ).toEqual({ ok: true });
  expect((await presence).users.map((u) => u.user_id)).toContain(editor);
  expect(
    await b.timeout(3000).emitWithAck('thread:composing', { thread_id: thread, composing: true }),
  ).toEqual({ error: 'forbidden' });
  const closed = new Promise<{ users: unknown[] }>((resolve) => b.once('thread:presence', resolve));
  await a.timeout(3000).emitWithAck('thread:composing', { thread_id: thread, composing: false });
  expect((await closed).users).toHaveLength(0);
  await db
    .deleteFrom('mailbox_members')
    .where('mailbox_id', '=', box)
    .where('user_id', '=', editor)
    .execute();
  expect(
    await a.timeout(3000).emitWithAck('thread:composing', { thread_id: thread, composing: true }),
  ).toEqual({ error: 'forbidden' });
}, 30000);
