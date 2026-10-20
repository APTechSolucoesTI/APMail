import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createDb, migrate, audit, userCanReadThread } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashPassword } from '../../src/modules/auth.js';
import { hashToken } from '../../src/plugins/auth.js';
import { participants } from '../../src/modules/chat/service.js';

const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Banco de teste exclusivo obrigatório');
const db = createDb(url),
  origin = 'http://localhost:5173',
  secret = randomBytes(32).toString('base64');
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redisUrl,
    APP_URL: origin,
    SESSION_SECRET: secret,
    CREDENTIALS_ENCRYPTION_KEY: secret,
  }),
);
let ip = 0;
const tenant = randomUUID(),
  otherTenant = randomUUID(),
  mailbox = randomUUID(),
  thread = randomUUID(),
  message = randomUUID();
const password = 'QaAccess123!';
async function call(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  cookie: string,
  payload?: unknown,
) {
  return app.inject({
    method,
    url: '/api' + path,
    remoteAddress: '127.45.' + Math.floor(++ip / 240) + '.' + ((ip % 240) + 1),
    headers: {
      origin,
      cookie,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}
async function account(role: 'owner' | 'admin' | 'member' = 'member', tenantId = tenant) {
  const id = randomUUID(),
    email = 'access-' + id + '@qa.example';
  await db
    .insertInto('users')
    .values({
      id,
      email,
      full_name: role === 'owner' ? 'Gestor original' : 'Usuário QA',
      password_hash: await hashPassword(password),
      current_tenant_id: tenantId,
    })
    .execute();
  await db.insertInto('user_preferences').values({ user_id: id }).execute();
  await db
    .insertInto('tenant_members')
    .values({ tenant_id: tenantId, user_id: id, role })
    .execute();
  const response = await call('POST', '/auth/login', '', { email, password });
  expect(response.statusCode, response.body).toBe(200);
  return { id, email, cookie: String(response.headers['set-cookie']).split(';')[0]! };
}
type Account = Awaited<ReturnType<typeof account>>;
let owner: Account, admin: Account, member: Account, outsider: Account;
async function profile(name: string, permissions: string[]) {
  const response = await call('POST', '/access-profiles', owner.cookie, {
    name: name + '-' + randomUUID().slice(0, 8),
    permissions,
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json() as { id: string; name: string; permissions: string[] };
}
async function assign(user: Account, profileId: string | null, mailboxRoles: unknown[] = []) {
  const response = await call('PUT', '/members/' + user.id + '/access', owner.cookie, {
    tenant_role: 'member',
    access_profile_id: profileId,
    mailbox_roles: mailboxRoles,
  });
  expect(response.statusCode, response.body).toBe(200);
}
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  for (const id of [tenant, otherTenant])
    await db
      .insertInto('tenants')
      .values({ id, name: 'QA Acessos', slug: 'access-' + id })
      .execute();
  owner = await account('owner');
  admin = await account('admin');
  member = await account();
  outsider = await account('owner', otherTenant);
  await db
    .insertInto('mailboxes')
    .values({
      id: mailbox,
      tenant_id: tenant,
      name: 'Comercial QA',
      email_address: 'comercial@qa.example',
      imap_host: 'localhost',
      imap_port: 993,
      imap_secure: true,
      smtp_host: 'localhost',
      smtp_port: 465,
      smtp_secure: true,
      username: 'qa',
      status: 'active',
    })
    .execute();
  await db
    .insertInto('threads')
    .values({ id: thread, tenant_id: tenant, mailbox_id: mailbox, subject: 'Proposta especial' })
    .execute();
  await db
    .insertInto('messages')
    .values({
      id: message,
      tenant_id: tenant,
      mailbox_id: mailbox,
      thread_id: thread,
      subject: 'Proposta especial',
      body_text: 'Olá Ana, confirmamos a proposta de R$ 4.500.',
      from_address: 'comercial@qa.example',
      to_addresses: sql`${JSON.stringify([{ email: 'ana@cliente.example', name: 'Ana' }])}::jsonb`,
      direction: 'outbound',
      message_at: new Date(),
      message_id_header: '<' + message + '@qa.example>',
    })
    .execute();
}, 30000);
afterAll(async () => {
  await app.close();
  await db.destroy();
});

it('administradores acessam auditoria; membros comuns não consultam nem exportam', async () => {
  expect((await call('GET', '/access-profiles', member.cookie)).statusCode).toBe(403);
  expect((await call('GET', '/audit-logs', admin.cookie)).statusCode).toBe(200);
  expect((await call('GET', '/audit-logs', member.cookie)).statusCode).toBe(403);
  expect((await call('GET', '/audit-logs/export.csv', member.cookie)).statusCode).toBe(403);
});
it('permite um perfil somente de convites e nega as demais APIs, inclusive URLs diretas', async () => {
  const p = await profile('Cadastro', ['users.view', 'users.invite']);
  await assign(member, p.id);
  const me = await call('GET', '/auth/me', member.cookie);
  expect(me.json().tenants[0]).toMatchObject({
    access_profile_id: p.id,
    access_profile_name: p.name,
    access_permissions: p.permissions,
  });
  expect((await call('GET', '/members', member.cookie)).statusCode).toBe(200);
  for (const path of [
    '/mailboxes',
    '/contacts',
    '/calendar/events',
    '/audit-logs',
    '/chat/conversations',
    '/integrations/google',
    '/outbox',
  ])
    expect((await call('GET', path, member.cookie)).statusCode, path).toBe(403);
  expect(
    (await call('PUT', '/members/' + admin.id + '/status', member.cookie, { status: 'disabled' }))
      .statusCode,
  ).toBe(403);
  const invite = await call('POST', '/invitations', member.cookie, {
    email: 'new-' + randomUUID() + '@qa.example',
    tenant_role: 'member',
    access_profile_id: p.id,
    mailbox_roles: [],
  });
  expect(invite.statusCode, invite.body).toBe(201);
  const members = await call('GET', '/members', member.cookie);
  expect(
    members.json().invitations.find((i: { id: string }) => i.id === invite.json().id)
      .access_profile_name,
  ).toBe(p.name);
  expect(
    (
      await db
        .selectFrom('invitations')
        .select('access_profile_id')
        .where('id', '=', invite.json().id)
        .executeTakeFirstOrThrow()
    ).access_profile_id,
  ).toBe(p.id);
  expect(
    (
      await call('POST', '/invitations', member.cookie, {
        email: 'bad-' + randomUUID() + '@qa.example',
        tenant_role: 'admin',
        mailbox_roles: [],
      })
    ).statusCode,
  ).toBe(403);
  expect((await call('PUT', '/preferences', member.cookie, { theme: 'dark' })).statusCode).toBe(
    200,
  );
});
it('valida dependências, nomes, isolamento de tenant e perfis em uso', async () => {
  expect(
    (
      await call('POST', '/access-profiles', owner.cookie, {
        name: 'Inválido',
        permissions: ['users.invite'],
      })
    ).statusCode,
  ).toBe(400);
  const p = await profile('Somente leitura', ['mail']);
  expect(
    (
      await call('POST', '/access-profiles', owner.cookie, {
        name: p.name.toUpperCase(),
        permissions: [],
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await call('PUT', '/access-profiles/' + p.id, outsider.cookie, {
        name: 'Fora',
        permissions: [],
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call('PUT', '/members/' + outsider.id + '/access', owner.cookie, {
        tenant_role: 'member',
        access_profile_id: p.id,
        mailbox_roles: [],
      })
    ).statusCode,
  ).toBe(404);
  await assign(member, p.id);
  expect((await call('DELETE', '/access-profiles/' + p.id, owner.cookie)).statusCode).toBe(409);
  await assign(member, null);
  expect((await call('DELETE', '/access-profiles/' + p.id, owner.cookie)).statusCode).toBe(200);
});
it('o aceite de convite cria a associação persistente ao perfil personalizado', async () => {
  const p = await profile('Novo integrante', ['users.view']);
  const token = randomBytes(32).toString('base64url'),
    email = 'accept-' + randomUUID() + '@qa.example';
  await db
    .insertInto('invitations')
    .values({
      tenant_id: tenant,
      email,
      tenant_role: 'member',
      access_profile_id: p.id,
      invited_by: owner.id,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 60000),
      mailbox_roles: sql`'[]'::jsonb`,
    })
    .execute();
  const response = await call('POST', '/invitations/by-token/' + token + '/accept', '', {
    full_name: 'Novo usuário',
    password,
  });
  expect(response.statusCode, response.body).toBe(200);
  const cookie = String(response.headers['set-cookie']).split(';')[0]!;
  const me = await call('GET', '/auth/me', cookie);
  expect(me.json().tenants[0]).toMatchObject({
    role: 'member',
    access_profile_id: p.id,
    access_permissions: ['users.view'],
  });
  expect((await call('GET', '/mailboxes', cookie)).statusCode).toBe(403);
});
it('combina permissões de módulo e de caixa; revogação vale na próxima requisição', async () => {
  const p = await profile('Leitor', ['mail']);
  await assign(member, p.id, [{ mailbox_id: mailbox, role: 'mailbox_admin' }]);
  const boxes = await call('GET', '/mailboxes', member.cookie);
  expect(boxes.statusCode, boxes.body).toBe(200);
  expect(boxes.json()[0].permissions).toContain('read');
  expect(boxes.json()[0].permissions).not.toContain('send');
  expect((await call('POST', '/outbox', member.cookie, {})).statusCode).toBe(403);
  expect(
    (await call('PUT', '/access-profiles/' + p.id, owner.cookie, { name: p.name, permissions: [] }))
      .statusCode,
  ).toBe(200);
  expect((await call('GET', '/mailboxes', member.cookie)).statusCode).toBe(403);
});
it('não permite autoelevação nem concessão de permissões maiores ou acesso ao admin', async () => {
  const p = await profile('Gestor limitado', ['users.view', 'users.manage', 'profiles.manage']);
  await assign(member, p.id);
  expect(
    (
      await call('PUT', '/members/' + member.id + '/access', member.cookie, {
        tenant_role: 'admin',
        mailbox_roles: [],
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await call('PUT', '/members/' + admin.id + '/status', member.cookie, { status: 'disabled' }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await call('POST', '/access-profiles', member.cookie, {
        name: 'Elevação',
        permissions: ['audit.view'],
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await call('PUT', '/access-profiles/' + p.id, member.cookie, {
        name: p.name,
        permissions: ['users.view'],
      })
    ).statusCode,
  ).toBe(409);
});
it('preserva autoria, destinatários e o texto; lista nunca inclui o conteúdo', async () => {
  await audit(db, {
    tenantId: tenant,
    actorId: owner.id,
    action: 'message.replied',
    entityType: 'message',
    entityId: message,
    metadata: { outcome: 'completed', password: 'should-not-survive' },
    ip: '10.20.30.40',
    requestId: 'qa-request',
    eventKey: message + ':reply',
  });
  await db
    .updateTable('users')
    .set({ full_name: 'Nome alterado depois' })
    .where('id', '=', owner.id)
    .execute();
  const response = await call('GET', '/audit-logs?search=ana%40cliente.example', admin.cookie);
  expect(response.statusCode, response.body).toBe(200);
  const e = response.json().items.find((e: { action: string }) => e.action === 'message.replied');
  expect(e).toMatchObject({
    actor_name: 'Gestor original',
    message_subject: 'Proposta especial',
    ip: '10.20.30.40',
    has_content: true,
  });
  expect(e).not.toHaveProperty('message_content');
  expect(response.body).not.toContain('should-not-survive');
  const detail = await call('GET', '/audit-logs/' + e.id, admin.cookie);
  expect(detail.json().message_content).toContain('R$ 4.500');
  expect(detail.headers['cache-control']).toBe('no-store');
  expect((await call('GET', '/audit-logs/' + e.id, outsider.cookie)).statusCode).toBe(404);
  const auditor = await profile('Auditor', ['audit.view']);
  await assign(member, auditor.id);
  const limited = await call('GET', '/audit-logs/' + e.id, member.cookie);
  expect(limited.statusCode).toBe(200);
  expect(limited.json()).toMatchObject({
    has_content: true,
    can_read_content: false,
    message_content: null,
  });
  const list = await call('GET', '/audit-logs/options', member.cookie);
  expect(list.statusCode).toBe(200);
  expect(list.json().actors.some((a: { actor_id: string }) => a.actor_id === owner.id)).toBe(true);
});
it('audita consulta de conteúdo, evita duplicações e preserva dados após exclusão', async () => {
  const initial = await db
    .selectFrom('audit_logs')
    .select(['id', 'message_content'])
    .where('tenant_id', '=', tenant)
    .where('event_key', '=', message + ':reply')
    .executeTakeFirstOrThrow();
  await audit(db, {
    tenantId: tenant,
    actorId: owner.id,
    action: 'message.replied',
    entityType: 'message',
    entityId: message,
    eventKey: message + ':reply',
  });
  const copies = await db
    .selectFrom('audit_logs')
    .select('id')
    .where('tenant_id', '=', tenant)
    .where('event_key', '=', message + ':reply')
    .execute();
  expect(copies).toHaveLength(1);
  await db
    .updateTable('messages')
    .set({ deleted_at: new Date(), body_text: 'conteúdo alterado depois' })
    .where('id', '=', message)
    .execute();
  const detail = await call('GET', '/audit-logs/' + initial.id, admin.cookie);
  expect(detail.json().message_content).toBe(initial.message_content);
  const read = await db
    .selectFrom('audit_logs')
    .select('actor_id')
    .where('tenant_id', '=', tenant)
    .where('action', '=', 'audit.content_viewed')
    .execute();
  expect(read.some((r) => r.actor_id === admin.id)).toBe(true);
  const csv = await call('GET', '/audit-logs/export.csv?actions=message.replied', admin.cookie);
  expect(csv.statusCode, csv.body).toBe(200);
  expect(csv.headers['content-type']).toContain('text/csv');
  expect(csv.body).toContain('E-mail respondido');
  expect(csv.body).not.toContain('R$ 4.500');
});
it('revogar o módulo também protege notificações, destinatários de sockets e tarefas em segundo plano', async () => {
  await assign(member, null);
  const conversation = await call('POST', '/chat/conversations/direct', owner.cookie, {
    user_id: member.id,
  });
  expect(conversation.statusCode, conversation.body).toBe(200);
  const id = conversation.json().id as string;
  await db
    .insertInto('notifications')
    .values({
      tenant_id: tenant,
      user_id: member.id,
      type: 'chat_message',
      title: 'Conversa anterior',
      body: 'Conteúdo que não deve aparecer',
    })
    .execute();
  const p = await profile('Sem comunicação', ['users.view']);
  await assign(member, p.id);
  const delivered = await call('POST', '/chat/conversations/' + id + '/messages', owner.cookie, {
    client_id: randomUUID(),
    body: 'Mensagem privada após revogação',
  });
  expect(delivered.statusCode, delivered.body).toBe(200);
  expect((await participants(db, tenant, id)).map((p) => p.user_id)).not.toContain(member.id);
  expect((await call('GET', '/notifications', member.cookie)).json()).toEqual([]);
  expect((await call('GET', '/notifications/unread-count', member.cookie)).json()).toEqual({
    count: 0,
  });
  expect(await userCanReadThread(db, tenant, mailbox, member.id, thread)).toBe(false);
  const notifications = await db
    .selectFrom('notifications')
    .select('id')
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', member.id)
    .where('type', '=', 'chat_message')
    .execute();
  expect(notifications).toHaveLength(1);
});
