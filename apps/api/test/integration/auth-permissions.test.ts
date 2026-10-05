import { beforeAll, afterAll, expect, it, vi } from 'vitest';
vi.mock('../../src/lib/mailbox-probe.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/mailbox-probe.js')>()),
  assertMailboxConnection: vi.fn().mockResolvedValue({ imap: true, smtp: true }),
}));
import { randomBytes, randomUUID } from 'node:crypto';
import { createDb, migrate } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { getMailboxRole, requireMailboxPerm } from '../../src/authz/guards.js';
import { createQueues } from '@apmail/db';
import { hashToken } from '../../src/plugins/auth.js';
import { io } from 'socket.io-client';
const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Banco de teste exclusivo obrigatório.');
const redisUrl = process.env.REDIS_URL_TEST!;
const origin = 'http://localhost:5173';
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redisUrl,
    APP_URL: origin,
    ALLOW_PUBLIC_SIGNUP: 'true',
    SESSION_SECRET: randomBytes(32).toString('base64'),
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  }),
);
const db = createDb(url),
  queues = createQueues(redisUrl);
const suffix = randomUUID();
const testIp = '10.99.' + parseInt(suffix.slice(0, 2), 16) + '.' + parseInt(suffix.slice(2, 4), 16);
let cookieA = '',
  cookieB = '',
  ownerA = '',
  ownerB = '',
  tenantA = '',
  mailboxA = '';
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  cookie: string,
  payload?: unknown,
  extra: Record<string, string> = {},
) =>
  app.inject({
    method,
    url,
    headers: { origin, cookie, ...extra },
    ...(payload !== undefined
      ? {
          payload: JSON.stringify(payload),
          headers: { origin, cookie, 'content-type': 'application/json', ...extra },
        }
      : {}),
  });
const cookieFrom = (response: Awaited<ReturnType<typeof call>>) =>
  String(response.headers['set-cookie']).split(';')[0]!;
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  const a = await call(
    'POST',
    '/api/auth/signup',
    '',
    { email: `a-${suffix}@apmail.local`, full_name: 'Proprietário A', password: 'Senha@123' },
    { 'x-forwarded-for': testIp },
  );
  expect(a.statusCode).toBe(201);
  cookieA = cookieFrom(a);
  ownerA = a.json().user.id;
  const b = await call(
    'POST',
    '/api/auth/signup',
    '',
    { email: `b-${suffix}@apmail.local`, full_name: 'Proprietário B', password: 'Senha@123' },
    { 'x-forwarded-for': testIp.replace('10.99.', '10.100.') },
  );
  cookieB = cookieFrom(b);
  ownerB = b.json().user.id;
  const t = await call('POST', '/api/tenants', cookieA, { name: 'Empresa A', slug: 'a-' + suffix });
  expect(t.statusCode).toBe(201);
  tenantA = t.json().id;
  await call('POST', '/api/tenants', cookieB, { name: 'Empresa B', slug: 'b-' + suffix });
  const box = await call('POST', '/api/mailboxes', cookieA, {
    name: 'Comercial',
    email_address: `box-${suffix}@apmail.local`,
    imap_host: 'localhost',
    imap_port: 3143,
    imap_secure: false,
    smtp_host: 'localhost',
    smtp_port: 3025,
    smtp_secure: false,
    username: 'demo',
    password: 'Segredo@123',
    members: [],
  });
  expect(box.statusCode).toBe(201);
  mailboxA = box.json().id;
}, 30000);
afterAll(async () => {
  await app.close();
  await db.destroy();
  await queues.close();
});
it('cadastro, sessão e onboarding não expõem credenciais', async () => {
  const me = await call('GET', '/api/auth/me', cookieA);
  expect(me.statusCode).toBe(200);
  expect(me.json().tenants[0].role).toBe('owner');
  const box = await call('GET', '/api/mailboxes/' + mailboxA, cookieA);
  expect(box.statusCode).toBe(200);
  for (const response of [me, box])
    expect(response.body).not.toMatch(/password_hash|encrypted_password|token_hash|Segredo/);
  const credential = await db
    .selectFrom('mailbox_credentials')
    .select('encrypted_password')
    .where('tenant_id', '=', tenantA)
    .where('mailbox_id', '=', mailboxA)
    .executeTakeFirstOrThrow();
  expect(credential.encrypted_password).toMatch(/^v1:/);
  expect(credential.encrypted_password).not.toContain('Segredo');
});
it('isola caixas, usuários e convites entre empresas', async () => {
  expect((await call('GET', '/api/mailboxes/' + mailboxA, cookieB)).statusCode).toBe(404);
  expect((await call('GET', '/api/mailboxes', cookieB)).json()).toEqual([]);
  expect((await call('GET', '/api/members/' + ownerA + '/access', cookieB)).statusCode).toBe(404);
  expect(
    (
      await call('PUT', '/api/mailboxes/' + mailboxA + '/members/' + ownerB, cookieB, {
        role: 'editor',
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call('POST', '/api/invitations', cookieB, {
        email: 'other-' + suffix + '@apmail.local',
        tenant_role: 'member',
        mailbox_roles: [{ mailbox_id: mailboxA, role: 'editor' }],
      })
    ).statusCode,
  ).toBe(404);
});
it('aplica a matriz de permissões e nega usuários desativados', async () => {
  const base = {
    tenantId: tenantA,
    tenantRole: 'member' as const,
    requestId: 'test',
    ip: 'test',
    sessionHash: 'test',
  };
  for (const role of ['viewer', 'editor', 'mailbox_admin'] as const) {
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tenantA, user_id: ownerB, role: 'member', status: 'active' })
      .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doUpdateSet({ status: 'active' }))
      .execute();
    await db
      .insertInto('mailbox_members')
      .values({ tenant_id: tenantA, mailbox_id: mailboxA, user_id: ownerB, role })
      .onConflict((oc) => oc.columns(['mailbox_id', 'user_id']).doUpdateSet({ role }))
      .execute();
    const c = { ...base, userId: ownerB, mailboxRoles: new Map() };
    expect(await getMailboxRole(c, db, mailboxA)).toBe(role);
    await requireMailboxPerm(c, db, mailboxA, 'read');
    if (role === 'viewer')
      await expect(requireMailboxPerm(c, db, mailboxA, 'send')).rejects.toMatchObject({
        statusCode: 403,
      });
    else await requireMailboxPerm(c, db, mailboxA, 'send');
    if (role !== 'mailbox_admin')
      await expect(requireMailboxPerm(c, db, mailboxA, 'organize')).rejects.toMatchObject({
        statusCode: 403,
      });
  }
  expect(
    await getMailboxRole(
      { ...base, userId: ownerA, tenantRole: 'admin', mailboxRoles: new Map() },
      db,
      mailboxA,
    ),
  ).toBe('mailbox_admin');
  await db
    .deleteFrom('mailbox_members')
    .where('tenant_id', '=', tenantA)
    .where('user_id', '=', ownerB)
    .execute();
  await expect(
    requireMailboxPerm({ ...base, userId: ownerB, mailboxRoles: new Map() }, db, mailboxA, 'read'),
  ).rejects.toMatchObject({ statusCode: 404 });
  await call('PUT', '/api/me/current-tenant', cookieB, { tenant_id: tenantA });
  expect(
    (await call('PUT', '/api/members/' + ownerB + '/status', cookieA, { status: 'disabled' }))
      .statusCode,
  ).toBe(200);
  expect((await call('GET', '/api/mailboxes/' + mailboxA, cookieB)).statusCode).toBe(404);
});
it('protege o último proprietário inclusive no banco', async () => {
  const response = await call('PUT', '/api/members/' + ownerA + '/access', cookieA, {
    tenant_role: 'member',
    mailbox_roles: [],
  });
  expect(response.statusCode).toBe(409);
  expect(response.body).toContain('proprietário ativo');
  await expect(
    db
      .updateTable('tenant_members')
      .set({ role: 'member' })
      .where('tenant_id', '=', tenantA)
      .where('user_id', '=', ownerA)
      .execute(),
  ).rejects.toThrow('last_owner');
});
it('valida origem e limita tentativas por e-mail', async () => {
  expect(
    (
      await call(
        'POST',
        '/api/auth/login',
        '',
        { email: 'wrong@apmail.local', password: 'abc' },
        { origin: 'https://evil.example' },
      )
    ).statusCode,
  ).toBe(403);
  const email = 'limit-' + suffix + '@apmail.local';
  for (let i = 0; i < 5; i++)
    expect(
      (
        await call(
          'POST',
          '/api/auth/login',
          '',
          { email, password: 'Senha@123' },
          { 'x-forwarded-for': '10.1.2.' + i },
        )
      ).statusCode,
    ).toBe(401);
  expect(
    (
      await call(
        'POST',
        '/api/auth/login',
        '',
        { email, password: 'Senha@123' },
        { 'x-forwarded-for': '10.1.3.9' },
      )
    ).statusCode,
  ).toBe(429);
});
it('aceita convites novos e existentes, revoga e esconde tokens', async () => {
  await db.updateTable('mailboxes').set({ status: 'active' }).where('id', '=', mailboxA).execute();
  const email = 'invite-' + suffix + '@apmail.local';
  const invite = await call('POST', '/api/invitations', cookieA, {
    email,
    tenant_role: 'member',
    mailbox_roles: [{ mailbox_id: mailboxA, role: 'viewer' }],
  });
  expect(invite.statusCode).toBe(201);
  expect(invite.body).not.toMatch(/token_hash/);
  const jobs = await queues.queues['system-email'].getJobs(['wait']);
  const job = jobs.find((j) => j.data.to === email);
  expect(job).toBeDefined();
  const token = new URL(job!.data.data.link).searchParams.get('token');
  expect((await call('GET', '/api/invitations/by-token/' + token, '')).json().user_exists).toBe(
    false,
  );
  const accepted = await call('POST', '/api/invitations/by-token/' + token + '/accept', '', {
    full_name: 'Convidado Novo',
    password: 'Senha@123',
  });
  expect(accepted.statusCode).toBe(200);
  expect((await call('GET', '/api/mailboxes', cookieFrom(accepted))).json()[0].role).toBe('viewer');
  expect(
    (
      await call('POST', '/api/invitations/by-token/' + token + '/accept', '', {
        full_name: 'Outro',
        password: 'Senha@123',
      })
    ).statusCode,
  ).toBe(409);
  const emailB = `b-${suffix}@apmail.local`;
  const existing = await call('POST', '/api/invitations', cookieA, {
    email: emailB,
    tenant_role: 'member',
    mailbox_roles: [],
  });
  expect(existing.statusCode).toBe(201);
  const j = (await queues.queues['system-email'].getJobs(['wait'])).find(
    (j) => j.data.to === emailB,
  )!;
  const t = new URL(j.data.data.link).searchParams.get('token');
  expect(
    (await call('POST', '/api/invitations/by-token/' + t + '/accept', '', {})).statusCode,
  ).toBe(409);
  expect(
    (await call('POST', '/api/invitations/by-token/' + t + '/accept', cookieB, {})).statusCode,
  ).toBe(200);
  const revoked = await call('POST', '/api/invitations', cookieA, {
    email: 'revoke-' + suffix + '@apmail.local',
    tenant_role: 'member',
    mailbox_roles: [],
  });
  expect((await call('DELETE', '/api/invitations/' + revoked.json().id, cookieB)).statusCode).toBe(
    403,
  );
  expect((await call('DELETE', '/api/invitations/' + revoked.json().id, cookieA)).statusCode).toBe(
    200,
  );
});
it('redefine senha com token único e invalida sessões anteriores', async () => {
  const email = `a-${suffix}@apmail.local`;
  expect((await call('POST', '/api/auth/forgot-password', '', { email })).statusCode).toBe(200);
  const j = (await queues.queues['system-email'].getJobs(['wait'])).find(
    (j) => j.data.to === email && j.name === 'password-reset',
  )!;
  const token = new URL(j.data.data.link).searchParams.get('token')!;
  expect(
    await db
      .selectFrom('password_reset_tokens')
      .select('id')
      .where('token_hash', '=', hashToken(token))
      .executeTakeFirst(),
  ).toBeDefined();
  const reset = await call('POST', '/api/auth/reset-password', '', {
    token,
    password: 'NovaSenha123',
  });
  expect(reset.statusCode).toBe(200);
  expect((await call('GET', '/api/auth/me', cookieA)).statusCode).toBe(401);
  cookieA = cookieFrom(reset);
  expect(
    (await call('POST', '/api/auth/reset-password', '', { token, password: 'OutraSenha123' }))
      .statusCode,
  ).toBe(400);
  expect((await call('GET', '/api/audit-logs', cookieA)).json().items.length).toBeGreaterThan(0);
});

it('autentica polling sem Origin pelo Referer e emite alterações de acesso', async () => {
  const address = await app.listen({ host: '127.0.0.1', port: 0 });
  const socket = io(address, {
    transports: ['polling'],
    extraHeaders: { Cookie: cookieB, Referer: origin + '/settings/profile' },
    reconnection: false,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket não conectou.')), 5000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
    });
    const changed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Evento não chegou.')), 5000);
      socket.once('mailboxes:changed', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    expect(
      (
        await call('PUT', '/api/mailboxes/' + mailboxA + '/members/' + ownerB, cookieA, {
          role: 'editor',
        })
      ).statusCode,
    ).toBe(200);
    await changed;
  } finally {
    socket.disconnect();
  }
});

it('limita login a dez tentativas por IP, mesmo com e-mails diferentes', async () => {
  const ip = '10.98.' + parseInt(suffix.slice(0, 2), 16) + '.' + parseInt(suffix.slice(2, 4), 16);
  for (let n = 0; n < 10; n++)
    expect(
      (
        await call(
          'POST',
          '/api/auth/login',
          '',
          { email: 'ip-' + n + '-' + suffix + '@apmail.local', password: 'Senha@123' },
          { 'x-forwarded-for': ip },
        )
      ).statusCode,
    ).toBe(401);
  expect(
    (
      await call(
        'POST',
        '/api/auth/login',
        '',
        { email: 'ip-11-' + suffix + '@apmail.local', password: 'Senha@123' },
        { 'x-forwarded-for': ip },
      )
    ).statusCode,
  ).toBe(429);
});
