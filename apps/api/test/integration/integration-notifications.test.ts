import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDb, migrate, ensureLocalFolders, touchThreads, asJson } from '@apmail/db';
import { Redis } from 'ioredis';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';

const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Banco TEST obrigatório');
const db = createDb(url);
const redis = new Redis(process.env.REDIS_URL_TEST!);
const tenant = randomUUID(),
  foreignTenant = randomUUID();
const origin = 'http://localhost:5173';
const config = envSchema.parse({
  NODE_ENV: 'test',
  DATABASE_URL: url,
  REDIS_URL: process.env.REDIS_URL_TEST,
  APP_URL: origin,
  SESSION_SECRET: randomBytes(32).toString('base64'),
  CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});
const app = await buildApp(config);
type User = { id: string; email: string; cookie: string };
let owner: User, foreignOwner: User;

async function user(tid = tenant, role: 'owner' | 'member' = 'member'): Promise<User> {
  const id = randomUUID(),
    email = id + '@notifications.test';
  await db
    .insertInto('users')
    .values({ id, email, full_name: 'Pessoa QA', password_hash: 'fixture', current_tenant_id: tid })
    .execute();
  await db.insertInto('tenant_members').values({ tenant_id: tid, user_id: id, role }).execute();
  const secret = randomBytes(32).toString('base64url');
  await db
    .insertInto('sessions')
    .values({
      user_id: id,
      token_hash: hashToken(secret),
      expires_at: new Date(Date.now() + 3600000),
    })
    .execute();
  return { id, email, cookie: 'apmail_session=' + encodeURIComponent(app.signCookie(secret)) };
}
function admin(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  payload?: unknown,
  who = owner,
) {
  return app.inject({
    method,
    url: '/api/integrations/api-tokens' + path,
    headers: {
      cookie: who.cookie,
      origin,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}
async function token(users: User[], who = owner) {
  const result = await admin('POST', '', { name: 'Integração QA', expires_in_days: 90 }, who);
  expect(result.statusCode, result.body).toBe(201);
  const created = result.json<{ id: string; token: string }>();
  const configured = await admin(
    'PUT',
    '/' + created.id + '/access',
    { permissions: ['notifications:read'], user_ids: users.map((u) => u.id) },
    who,
  );
  expect(configured.statusCode, configured.body).toBe(200);
  return created;
}
function notify(secret: string, email: string, headers: Record<string, string> = {}) {
  return app.inject({
    method: 'GET',
    url: '/api/integrations/notifications?email=' + encodeURIComponent(email),
    headers: { authorization: 'Bearer ' + secret, ...headers },
  });
}
async function box(
  member?: User,
  tid = tenant,
  role: 'editor' | 'supervisor' | 'viewer' = 'editor',
) {
  const id = randomUUID();
  await db
    .insertInto('mailboxes')
    .values({
      id,
      tenant_id: tid,
      name: 'Caixa QA',
      email_address: id + '@notifications.test',
      username: 'qa',
      receiving_protocol: 'pop3',
      imap_host: 'localhost',
      smtp_host: 'localhost',
      status: 'active',
      queues_enabled: false,
    })
    .execute();
  await ensureLocalFolders(db, tid, id);
  await db
    .insertInto('mailbox_members')
    .values({
      tenant_id: tid,
      mailbox_id: id,
      user_id: tid === tenant ? owner.id : foreignOwner.id,
      role: 'mailbox_admin',
    })
    .execute();
  if (member)
    await db
      .insertInto('mailbox_members')
      .values({ tenant_id: tid, mailbox_id: id, user_id: member.id, role })
      .execute();
  const folders = await db
    .selectFrom('folders')
    .select(['id', 'special_use'])
    .where('mailbox_id', '=', id)
    .execute();
  return {
    id,
    tenant: tid,
    inbox: folders.find((f) => f.special_use === 'inbox')!.id,
    trash: folders.find((f) => f.special_use === 'trash')!.id,
    junk: folders.find((f) => f.special_use === 'junk')!.id,
  };
}
async function message(
  b: Awaited<ReturnType<typeof box>>,
  assigned?: User,
  thread?: string,
  folder = b.inbox,
  time = new Date('2026-01-01T12:00:00Z'),
) {
  const id = randomUUID(),
    threadId = thread ?? randomUUID();
  if (!thread)
    await db
      .insertInto('threads')
      .values({
        id: threadId,
        tenant_id: b.tenant,
        mailbox_id: b.id,
        subject: 'Sigilo QA',
        assigned_to: assigned?.id ?? null,
        history_queue_eligible: true,
      })
      .execute();
  await db
    .insertInto('messages')
    .values({
      id,
      tenant_id: b.tenant,
      mailbox_id: b.id,
      thread_id: threadId,
      folder_id: folder,
      message_id_header: '<' + id + '@notifications.test>',
      subject: 'Sigilo QA',
      message_at: time,
      from_address: 'cliente@notifications.test',
      body_text: 'Conteúdo confidencial',
      direction: 'inbound',
      source_kind: 'imap',
      to_addresses: asJson([]),
    })
    .execute();
  await touchThreads(db, [threadId], 'sync', null);
  return { id, thread: threadId };
}
function mailAction(thread: string, action: string, who: User) {
  return app.inject({
    method: 'POST',
    url: `/api/threads/${thread}/${action}`,
    headers: { origin, cookie: who.cookie },
  });
}
function data(response: Awaited<ReturnType<typeof notify>>) {
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(Object.keys(response.json())).toEqual(['success', 'data']);
  expect(Object.keys(response.json().data).sort()).toEqual([
    'email',
    'hasNotifications',
    'pending',
    'unread',
  ]);
  return response.json().data as {
    email: string;
    unread: number;
    pending: number;
    hasNotifications: boolean;
  };
}

beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Notificações QA', slug: 'notification-' + tenant },
      { id: foreignTenant, name: 'Outra empresa QA', slug: 'notification-' + foreignTenant },
    ])
    .execute();
  owner = await user(tenant, 'owner');
  foreignOwner = await user(foreignTenant, 'owner');
}, 30000);
afterAll(async () => {
  await app.close();
  await redis.quit();
  await db.destroy();
});

it('cria a chave sem acesso e aplica concessão e remoção de rotas imediatamente', async () => {
  const u = await user(),
    other = await user();
  const created = await admin('POST', '', { name: 'Sistema externo' });
  expect(created.statusCode).toBe(201);
  const key = created.json<{ id: string; token: string; permissions: string[] }>();
  expect(key.permissions).toEqual([]);
  expect((await notify(key.token, u.email)).statusCode).toBe(403);
  const catalog = (await admin('GET', '')).json().routes;
  expect(catalog).toContainEqual(
    expect.objectContaining({
      method: 'GET',
      path: '/api/integrations/notifications',
      permission: 'notifications:read',
    }),
  );
  const configure = (permissions: string[], user_ids: string[], who = owner) =>
    admin('PUT', '/' + key.id + '/access', { permissions, user_ids }, who);
  expect((await configure(['mailboxes:all'], [u.id])).statusCode).toBe(400);
  expect((await configure(['notifications:read'], [])).statusCode).toBe(400);
  expect((await configure(['notifications:read'], [u.id], foreignOwner)).statusCode).toBe(404);
  expect((await configure(['notifications:read'], [u.id], u)).statusCode).toBe(403);
  expect((await configure(['notifications:read'], [u.id])).statusCode).toBe(200);
  expect((await notify(key.token, u.email)).statusCode).toBe(200);
  expect((await notify(key.token, other.email)).statusCode).toBe(404);
  expect((await configure(['notifications:read'], [other.id])).statusCode).toBe(200);
  expect((await notify(key.token, u.email)).statusCode).toBe(404);
  expect((await notify(key.token, other.email)).statusCode).toBe(200);
  expect((await configure([], [])).statusCode).toBe(200);
  expect((await notify(key.token, other.email)).statusCode).toBe(403);
  await admin('DELETE', '/' + key.id);
  expect((await configure(['notifications:read'], [u.id])).statusCode).toBe(404);
});

it('cria e renova chave ilimitada e continua permitindo revogá-la', async () => {
  const u = await user();
  const result = await admin('POST', '', { name: 'Sem vencimento', expires_in_days: null });
  expect(result.statusCode, result.body).toBe(201);
  const key = result.json<{ id: string; token: string; expires_at: string | null }>();
  expect(key.expires_at).toBeNull();
  expect(
    (
      await admin('PUT', '/' + key.id + '/access', {
        permissions: ['notifications:read'],
        user_ids: [u.id],
      })
    ).statusCode,
  ).toBe(200);
  expect((await notify(key.token, u.email)).statusCode).toBe(200);
  const listed = (await admin('GET', ''))
    .json()
    .tokens.find((item: { id: string }) => item.id === key.id);
  expect(listed).toMatchObject({ expires_at: null, expired: false });
  const renewed = await admin('POST', '/' + key.id + '/rotate', {});
  expect(renewed.statusCode, renewed.body).toBe(200);
  const rotated = renewed.json<{ token: string; expires_at: string | null }>();
  expect(rotated.expires_at).toBeNull();
  expect((await notify(key.token, u.email)).statusCode).toBe(401);
  expect((await notify(rotated.token, u.email)).statusCode).toBe(200);
  expect((await admin('DELETE', '/' + key.id)).statusCode).toBe(200);
  expect((await notify(rotated.token, u.email)).statusCode).toBe(401);
});

it('exclui somente chaves revogadas da própria empresa e remove seus vínculos', async () => {
  const u = await user(),
    key = await token([u]);
  const path = '/' + key.id + '/permanent';
  expect((await admin('DELETE', path)).statusCode).toBe(409);
  expect((await notify(key.token, u.email)).statusCode).toBe(200);
  expect((await admin('DELETE', '/' + key.id)).statusCode).toBe(200);
  expect((await admin('DELETE', path, undefined, foreignOwner)).statusCode).toBe(404);
  expect((await admin('DELETE', path, undefined, u)).statusCode).toBe(403);
  expect((await admin('DELETE', path)).statusCode).toBe(200);
  expect(
    await db.selectFrom('integration_api_tokens').select('id').where('id', '=', key.id).execute(),
  ).toEqual([]);
  expect(
    await db
      .selectFrom('integration_api_token_users')
      .select('user_id')
      .where('token_id', '=', key.id)
      .execute(),
  ).toEqual([]);
  expect(
    (await admin('GET', '')).json().tokens.some((item: { id: string }) => item.id === key.id),
  ).toBe(false);
  expect((await notify(key.token, u.email)).statusCode).toBe(401);
  expect((await admin('DELETE', path)).statusCode).toBe(404);
});

it('conta mensagens por usuário, reflete leitura e novos recebimentos sem alterar dados', async () => {
  const u = await user(),
    key = await token([u]),
    b = await box(u);
  expect(data(await notify(key.token, u.email))).toMatchObject({
    unread: 0,
    pending: 0,
    hasNotifications: false,
  });
  const first = await message(b, u);
  expect(data(await notify(key.token, u.email))).toMatchObject({
    unread: 1,
    pending: 1,
    hasNotifications: true,
  });
  await message(b, u, first.thread);
  const second = await message(b, u);
  const third = await message(b, u);
  await message(b, u, third.thread);
  const before = await db
    .selectFrom('messages')
    .selectAll()
    .where('mailbox_id', '=', b.id)
    .orderBy('id')
    .execute();
  expect(data(await notify(key.token, u.email.toUpperCase()))).toMatchObject({
    unread: 5,
    pending: 3,
    email: u.email,
  });
  expect(
    await db
      .selectFrom('messages')
      .selectAll()
      .where('mailbox_id', '=', b.id)
      .orderBy('id')
      .execute(),
  ).toEqual(before);
  expect(
    await db.selectFrom('thread_user_state').selectAll().where('user_id', '=', u.id).execute(),
  ).toEqual([]);
  expect((await mailAction(first.thread, 'read', u)).statusCode).toBe(200);
  expect(data(await notify(key.token, u.email)).unread).toBe(3);
  expect((await mailAction(second.thread, 'read', u)).statusCode).toBe(200);
  expect((await mailAction(third.thread, 'read', u)).statusCode).toBe(200);
  expect(data(await notify(key.token, u.email))).toMatchObject({ unread: 0, pending: 3 });
  await message(b, u, first.thread, b.inbox, new Date(Date.now() + 1000));
  expect(data(await notify(key.token, u.email)).unread).toBe(1);
  const ownerKey = await token([owner]);
  expect(data(await notify(ownerKey.token, owner.email)).unread).toBe(6);
  expect((await mailAction(second.thread, 'done', owner)).statusCode).toBe(200);
  expect(data(await notify(key.token, u.email)).pending).toBe(2);
  expect((await mailAction(second.thread, 'reopen', owner)).statusCode).toBe(200);
  expect(data(await notify(key.token, u.email)).pending).toBe(3);
});

it('respeita caixas, perfis, pastas descendentes e restrição dos operadores', async () => {
  const u = await user(),
    key = await token([u]);
  const b = await box(u),
    second = await box(u),
    secret = await box();
  await message(b, u);
  await message(b, owner);
  await message(second, u);
  await message(secret, u);
  expect(data(await notify(key.token, u.email))).toMatchObject({ unread: 3, pending: 3 });
  await db
    .updateTable('tenants')
    .set({ settings: asJson({ restrict_operators_to_assigned: true }) })
    .where('id', '=', tenant)
    .execute();
  expect(data(await notify(key.token, u.email))).toMatchObject({ unread: 2, pending: 2 });
  await db
    .updateTable('mailbox_members')
    .set({ role: 'supervisor' })
    .where('mailbox_id', '=', b.id)
    .where('user_id', '=', u.id)
    .execute();
  expect(data(await notify(key.token, u.email)).unread).toBe(3);
  await db
    .updateTable('mailbox_members')
    .set({ role: 'editor', restrict_to_folders: true })
    .where('mailbox_id', '=', b.id)
    .where('user_id', '=', u.id)
    .execute();
  expect(data(await notify(key.token, u.email)).unread).toBe(1);
  const child = randomUUID();
  await db
    .insertInto('folders')
    .values({
      id: child,
      tenant_id: tenant,
      mailbox_id: b.id,
      name: 'Filha',
      imap_path: 'INBOX/Filha',
      is_local: true,
      parent_id: b.inbox,
    })
    .execute();
  await db
    .insertInto('folder_permissions')
    .values({ tenant_id: tenant, mailbox_id: b.id, folder_id: b.inbox, user_id: u.id })
    .execute();
  await message(b, u, undefined, child);
  expect(data(await notify(key.token, u.email))).toMatchObject({ unread: 3, pending: 3 });
  await db
    .updateTable('tenant_members')
    .set({ custom_permissions: [] })
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', u.id)
    .execute();
  expect((await notify(key.token, u.email)).statusCode).toBe(404);
  await db
    .updateTable('tenants')
    .set({ settings: asJson({ restrict_operators_to_assigned: false }) })
    .where('id', '=', tenant)
    .execute();
});

it('inclui apenas o convite privado ativo e encerra o acesso na conclusão', async () => {
  const u = await user(),
    key = await token([u]),
    b = await box();
  const invited = await message(b, owner);
  await message(b, owner);
  expect(data(await notify(key.token, u.email)).unread).toBe(0);
  const invite = await app.inject({
    method: 'POST',
    url: `/api/threads/${invited.thread}/invitations`,
    headers: { origin, cookie: owner.cookie, 'content-type': 'application/json' },
    payload: { user_id: u.id },
  });
  expect(invite.statusCode, invite.body).toBe(201);
  expect(data(await notify(key.token, u.email))).toMatchObject({ unread: 1, pending: 1 });
  expect((await mailAction(invited.thread, 'done', u)).statusCode).toBe(200);
  expect(data(await notify(key.token, u.email))).toMatchObject({ unread: 0, pending: 0 });
  await mailAction(invited.thread, 'reopen', owner);
  expect(data(await notify(key.token, u.email)).unread).toBe(0);
});

it('não inclui lixeira, spam, mensagens retidas ou conversas excluídas', async () => {
  const u = await user(),
    key = await token([u]),
    b = await box(u);
  await message(b, u, undefined, b.trash);
  await message(b, u, undefined, b.junk);
  const deleted = await message(b, u),
    thread = await message(b, u);
  await db
    .updateTable('messages')
    .set({ deleted_at: new Date() })
    .where('id', '=', deleted.id)
    .execute();
  await db
    .updateTable('threads')
    .set({ deleted_at: new Date() })
    .where('id', '=', thread.thread)
    .execute();
  expect(data(await notify(key.token, u.email))).toMatchObject({ unread: 0, pending: 0 });
});

it('não revela usuário inexistente, fora da lista, desativado ou de outro tenant', async () => {
  const u = await user(),
    excluded = await user(),
    key = await token([u]);
  const responses = await Promise.all([
    notify(key.token, 'inexistente@notifications.test'),
    notify(key.token, excluded.email),
    notify(key.token, foreignOwner.email),
  ]);
  expect(responses.map((r) => r.statusCode)).toEqual([404, 404, 404]);
  expect(new Set(responses.map((r) => r.body)).size).toBe(1);
  await db
    .updateTable('tenant_members')
    .set({ status: 'disabled' })
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', u.id)
    .execute();
  expect((await notify(key.token, u.email)).body).toBe(responses[0]!.body);
  expect(
    (
      await admin('PUT', '/' + key.id + '/access', {
        permissions: ['notifications:read'],
        user_ids: [foreignOwner.id],
      })
    ).statusCode,
  ).toBe(404);
  const foreignKey = await token([foreignOwner], foreignOwner);
  expect((await notify(foreignKey.token, owner.email)).statusCode).toBe(404);
});

it('armazena somente hash, renova, expira e revoga sem aceitar sessão como token', async () => {
  const u = await user(),
    key = await token([u]);
  const stored = await db
    .selectFrom('integration_api_tokens')
    .selectAll()
    .where('id', '=', key.id)
    .executeTakeFirstOrThrow();
  expect(stored.token_hash).toBe(hashToken(key.token));
  expect(JSON.stringify(stored)).not.toContain(key.token);
  const list = await admin('GET', '');
  expect(list.body).not.toContain(key.token);
  expect(list.body).not.toContain('token_hash');
  const missing = await app.inject({
    method: 'GET',
    url: '/api/integrations/notifications?email=' + u.email,
    headers: { cookie: owner.cookie },
  });
  expect(missing.statusCode).toBe(401);
  const invalid = await notify('invalid', u.email);
  expect(invalid.statusCode).toBe(401);
  const rotated = await admin('POST', '/' + key.id + '/rotate', {});
  expect(rotated.statusCode, rotated.body).toBe(200);
  const next = rotated.json<{ token: string }>().token;
  expect((await notify(key.token, u.email)).body).toBe(invalid.body);
  expect((await notify(next, u.email)).statusCode).toBe(200);
  await db
    .updateTable('integration_api_tokens')
    .set({ created_at: new Date('2020-01-01'), expires_at: new Date('2021-01-01') })
    .where('id', '=', key.id)
    .execute();
  expect((await notify(next, u.email)).body).toBe(invalid.body);
  const renewed = (await admin('POST', '/' + key.id + '/rotate', {})).json<{ token: string }>()
    .token;
  expect((await admin('DELETE', '/' + key.id)).statusCode).toBe(200);
  expect((await notify(renewed, u.email)).body).toBe(invalid.body);
  expect((await admin('POST', '/' + key.id + '/rotate', {})).statusCode).toBe(404);
  expect(
    (
      await app.inject({
        method: 'GET',
        url: '/api/mailboxes',
        headers: { authorization: 'Bearer ' + next },
      })
    ).statusCode,
  ).toBe(401);
  expect((await admin('GET', '', undefined, u)).statusCode).toBe(403);
  expect((await admin('DELETE', '/' + key.id, undefined, foreignOwner)).statusCode).toBe(404);
  expect((await notify(next, 'invalid-email')).statusCode).toBe(401);
});

it('aplica limite por integração compartilhado entre instâncias e valida a consulta', async () => {
  const u = await user(),
    key = await token([u]);
  expect((await notify(key.token, 'invalid-email')).statusCode).toBe(400);
  const limiterKeys = await redis.keys('*notification:' + key.id + '*');
  expect(limiterKeys).toHaveLength(1);
  await redis.set(limiterKeys[0]!, '1200', 'EX', 60);
  const limited = await notify(key.token, u.email);
  expect(limited.statusCode, limited.body).toBe(429);
  expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
  const separate = await token([u]);
  expect((await notify(separate.token, u.email)).statusCode).toBe(200);
});

it('exige HTTPS em produção e limita tentativas com credenciais inválidas', async () => {
  const u = await user(),
    key = await token([u]);
  config.NODE_ENV = 'production';
  try {
    expect((await notify(key.token, u.email)).statusCode).toBe(403);
    expect((await notify(key.token, u.email, { 'x-forwarded-proto': 'https' })).statusCode).toBe(
      200,
    );
  } finally {
    config.NODE_ENV = 'test';
  }
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = await notify('invalid', u.email, { 'x-forwarded-for': '192.0.2.201' });
    expect(result.statusCode).toBe(401);
  }
  expect((await notify('invalid', u.email, { 'x-forwarded-for': '192.0.2.201' })).statusCode).toBe(
    429,
  );
});
