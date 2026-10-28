import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { createDb, migrate, asJson } from '@apmail/db';
import { defaultAccessSchedule, type AccessSchedule } from '@apmail/shared';
import { io } from 'socket.io-client';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken, createSession } from '../../src/plugins/auth.js';
import { hashPassword } from '../../src/modules/auth.js';
const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Dedicated test database required');
const db = createDb(url),
  tenant = randomUUID(),
  other = randomUUID(),
  owner = randomUUID(),
  operator = randomUUID(),
  manager = randomUUID(),
  outsider = randomUUID();
const origin = 'http://localhost:5190';
const config = envSchema.parse({
  NODE_ENV: 'test',
  DATABASE_URL: url,
  REDIS_URL: process.env.REDIS_URL_TEST!,
  APP_URL: origin,
  SESSION_SECRET: randomBytes(32).toString('base64'),
  CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});
const app = await buildApp(config);
app.post('/api/auth/qa-schedule-session', async (req, reply) => {
  await createSession(db, config, req, reply, operator);
  return { ok: true };
});
const cookies = new Map<string, string>();
const blocked = (): AccessSchedule => ({
  enabled: true,
  weekly: Array.from({ length: 7 }, () => []),
  exceptions: [],
});
const allowed = (): AccessSchedule => ({
  enabled: true,
  weekly: Array.from({ length: 7 }, () => [{ start: '00:00', end: '24:00' }]),
  exceptions: [],
});
async function session(id: string) {
  const token = randomBytes(32).toString('base64url');
  await db
    .insertInto('sessions')
    .values({
      user_id: id,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 3600000),
    })
    .execute();
  return 'apmail_session=' + encodeURIComponent(app.signCookie(token));
}
function call(
  method: 'GET' | 'PUT' | 'POST',
  path: string,
  payload?: unknown,
  who = owner,
  cookie?: string,
) {
  return app.inject({
    method,
    url: '/api' + path,
    headers: { origin, cookie: cookie ?? cookies.get(who)! },
    ...(payload ? { payload } : {}),
  });
}
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Schedule QA', slug: tenant },
      { id: other, name: 'Other QA', slug: other },
    ])
    .execute();
  const password = await hashPassword('ScheduleQA123');
  for (const [id, role, t] of [
    [owner, 'owner', tenant],
    [operator, 'member', tenant],
    [manager, 'member', tenant],
    [outsider, 'member', other],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@qa.example',
        full_name: 'Schedule QA',
        password_hash: password,
        current_tenant_id: t,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({
        tenant_id: t,
        user_id: id,
        role,
        ...(id === manager ? { custom_permissions: ['users.view', 'users.manage'] } : {}),
      })
      .execute();
    await db.insertInto('user_preferences').values({ user_id: id }).execute();
    cookies.set(id, await session(id));
  }
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
it('retorna acesso livre por padrão, persiste expediente e registra auditoria', async () => {
  const initial = await call('GET', `/members/${operator}/access-schedule`);
  expect(initial.statusCode).toBe(200);
  expect(initial.json().schedule.enabled).toBe(false);
  const schedule = defaultAccessSchedule();
  schedule.enabled = true;
  schedule.exceptions.push({ date: '2026-11-02', intervals: [], reason: 'Feriado' });
  const result = await call('PUT', `/members/${operator}/access-schedule`, schedule);
  expect(result.statusCode, result.body).toBe(200);
  expect((await call('GET', `/members/${operator}/access-schedule`)).json().schedule).toEqual(
    schedule,
  );
  expect(
    await db
      .selectFrom('audit_logs')
      .select('id')
      .where('tenant_id', '=', tenant)
      .where('action', '=', 'member.access_schedule_updated')
      .executeTakeFirst(),
  ).toBeDefined();
});
it('isola empresas e impede alteração própria, de administradores e sem permissão por delegados', async () => {
  await db
    .updateTable('tenant_members')
    .set({ access_schedule: null })
    .where('user_id', '=', operator)
    .execute();
  expect((await call('GET', `/members/${outsider}/access-schedule`)).statusCode).toBe(404);
  expect(
    (await call('PUT', `/members/${operator}/access-schedule`, allowed(), operator)).statusCode,
  ).toBe(403);
  expect(
    (await call('GET', `/members/${operator}/access-schedule`, undefined, operator)).statusCode,
  ).toBe(403);
  expect(
    (await call('PUT', `/members/${owner}/access-schedule`, blocked(), manager)).statusCode,
  ).toBe(403);
  expect(
    (await call('PUT', `/members/${manager}/access-schedule`, blocked(), manager)).statusCode,
  ).toBe(403);
  expect(
    (await call('PUT', `/members/${operator}/access-schedule`, allowed(), manager)).statusCode,
  ).toBe(200);
});
it('rejeita sobreposição e datas repetidas no servidor', async () => {
  const invalid = allowed();
  invalid.weekly[1]!.push({ start: '08:00', end: '12:00' });
  expect((await call('PUT', `/members/${operator}/access-schedule`, invalid)).statusCode).toBe(400);
  invalid.weekly[1] = [];
  invalid.exceptions = Array.from({ length: 2 }, () => ({
    date: '2026-11-02',
    intervals: [],
    reason: '',
  }));
  expect((await call('PUT', `/members/${operator}/access-schedule`, invalid)).statusCode).toBe(400);
});
it('nega login com senha correta e todos os emissores de sessão fora do expediente', async () => {
  await call('PUT', `/members/${operator}/access-schedule`, blocked());
  const result = await call(
    'POST',
    '/auth/login',
    { email: operator + '@qa.example', password: 'ScheduleQA123' },
    owner,
    '',
  );
  expect(result.statusCode, result.body).toBe(403);
  expect(result.json().error.code).toBe('outside_access_schedule');
  expect(result.headers['set-cookie']).toBeUndefined();
  const proof = await call('POST', '/auth/qa-schedule-session', {}, owner, '');
  expect(proof.statusCode, proof.body).toBe(403);
});
it('bloqueia sessão existente, revoga o token e não permite trocar para empresa restrita', async () => {
  const cookie = await session(operator);
  const result = await call('GET', '/auth/me', undefined, operator, cookie);
  expect(result.statusCode).toBe(403);
  expect(result.json().error.code).toBe('outside_access_schedule');
  expect(String(result.headers['set-cookie'])).toContain('Max-Age=0');
  expect((await call('GET', '/auth/me', undefined, operator, cookie)).statusCode).toBe(401);
  await db
    .insertInto('tenant_members')
    .values({ tenant_id: other, user_id: operator, role: 'member' })
    .execute();
  await db
    .updateTable('users')
    .set({ current_tenant_id: other })
    .where('id', '=', operator)
    .execute();
  const otherCookie = await session(operator);
  const switchResult = await call(
    'PUT',
    '/me/current-tenant',
    { tenant_id: tenant },
    operator,
    otherCookie,
  );
  expect(switchResult.statusCode).toBe(403);
  await db
    .updateTable('users')
    .set({ current_tenant_id: tenant })
    .where('id', '=', operator)
    .execute();
});
it('exceção extraordinária libera login e acesso livre desabilita as regras', async () => {
  const schedule = blocked();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  schedule.exceptions.push({
    date,
    intervals: [{ start: '00:00', end: '24:00' }],
    reason: 'Plantão',
  });
  await call('PUT', `/members/${operator}/access-schedule`, schedule);
  const result = await call(
    'POST',
    '/auth/login',
    { email: operator + '@qa.example', password: 'ScheduleQA123' },
    owner,
    '',
  );
  expect(result.statusCode, result.body).toBe(200);
  schedule.enabled = false;
  schedule.exceptions = [];
  await call('PUT', `/members/${operator}/access-schedule`, schedule);
  expect(
    (await call('GET', '/auth/me', undefined, operator, await session(operator))).statusCode,
  ).toBe(200);
});
it('encerra conexão ociosa no limite de minuto sem depender de ação do usuário', async () => {
  await db
    .updateTable('tenant_members')
    .set({ access_schedule: asJson(allowed()) })
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', operator)
    .execute();
  const cookie = await session(operator),
    address = await app.listen({ host: '127.0.0.1', port: 0 });
  const socket = io(address, {
    transports: ['websocket'],
    extraHeaders: { Cookie: cookie, Origin: origin },
    reconnection: false,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    const denied = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error('Idle connection remained open after schedule check')),
        65000,
      );
      socket.once('access:schedule-blocked', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    const disconnected = new Promise<void>((resolve) => socket.once('disconnect', () => resolve()));
    await db
      .updateTable('tenant_members')
      .set({ access_schedule: asJson(blocked()) })
      .where('tenant_id', '=', tenant)
      .where('user_id', '=', operator)
      .execute();
    await denied;
    await disconnected;
    expect((await call('GET', '/auth/me', undefined, operator, cookie)).statusCode).toBe(401);
  } finally {
    socket.disconnect();
  }
}, 75000);
