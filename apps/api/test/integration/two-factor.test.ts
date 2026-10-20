import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { createDb, migrate } from '@apmail/db';
import { Redis } from 'ioredis';
import { TOTP } from 'otpauth';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashPassword } from '../../src/modules/auth.js';
import { hashToken, createSession } from '../../src/plugins/auth.js';

const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Banco de teste exclusivo obrigatório');
const db = createDb(url),
  redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
const key = randomBytes(32).toString('base64'),
  origin = 'http://localhost:5173';
const config = envSchema.parse({
  NODE_ENV: 'test',
  DATABASE_URL: url,
  REDIS_URL: redisUrl,
  APP_URL: origin,
  SESSION_SECRET: key,
  CREDENTIALS_ENCRYPTION_KEY: key,
  ALLOW_PUBLIC_SIGNUP: 'true',
});
const app = await buildApp(config);
// Test-only entry point: new session issuers must share the central MFA guard.
app.post('/api/auth/qa-session-proof', async (req, reply) => {
  const { user_id } = req.body as { user_id: string };
  await createSession(db, config, req, reply, user_id);
  return { ok: true };
});
const password = 'QaPassword123!';
let ip = 0;
async function call(method: 'GET' | 'POST' | 'DELETE', path: string, cookie = '', body?: unknown) {
  return app.inject({
    method,
    url: '/api' + path,
    remoteAddress: '127.1.' + Math.floor(++ip / 240) + '.' + ((ip % 240) + 1),
    headers: { origin, ...(cookie ? { cookie } : {}) },
    ...(body ? { payload: body } : {}),
  });
}
function cookie(response: Awaited<ReturnType<typeof call>>) {
  const cookies = response.headers['set-cookie'];
  return (Array.isArray(cookies) ? cookies : [cookies])
    .filter(Boolean)
    .map((c) => c!.split(';')[0])
    .join('; ');
}
async function account(platform = false) {
  const id = randomUUID(),
    email = 'two-factor-' + id + '@qa.example';
  await db
    .insertInto('users')
    .values({ id, email, full_name: '2FA QA', password_hash: await hashPassword(password) })
    .execute();
  await db.insertInto('user_preferences').values({ user_id: id }).execute();
  if (platform) await db.insertInto('platform_admins').values({ user_id: id }).execute();
  const login = await call('POST', '/auth/login', '', { email, password });
  expect(login.statusCode, login.body).toBe(200);
  return { id, email, cookie: cookie(login) };
}
type Account = Awaited<ReturnType<typeof account>>;
async function enrolled(user = undefined as Account | undefined) {
  const a = user ?? (await account());
  const setup = await call('POST', '/auth/two-factor/setup', a.cookie, { password });
  expect(setup.statusCode, setup.body).toBe(200);
  const secret = setup.json().manual_key as string;
  const totp = new TOTP({ secret, algorithm: 'SHA1', digits: 6, period: 30 });
  const enabled = await call('POST', '/auth/two-factor/enable', a.cookie, {
    code: totp.generate(),
  });
  expect(enabled.statusCode, enabled.body).toBe(200);
  return { ...a, secret, totp, codes: enabled.json().recovery_codes as string[] };
}
async function challenge(a: Account) {
  const response = await call('POST', '/auth/login', '', { email: a.email, password });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({ requires_two_factor: true });
  expect(cookie(response)).toBe('');
  return response.json().challenge as string;
}
beforeAll(async () => {
  await migrate(url);
  await app.ready();
}, 30000);
afterAll(async () => {
  await app.close();
  await redis.quit();
  await db.destroy();
});

it('contas existentes continuam sem 2FA e a senha sozinha cria sessão enquanto estiver desativado', async () => {
  const a = await account();
  expect((await call('GET', '/auth/two-factor', a.cookie)).json()).toEqual({
    enabled: false,
    enabled_at: null,
    recovery_codes_remaining: 0,
  });
  expect((await call('GET', '/auth/me', a.cookie)).statusCode).toBe(200);
  expect((await call('GET', '/auth/two-factor')).statusCode).toBe(401);
});
it('setup exige senha, não ativa sozinho, gera QR local, mantém o segredo criptografado e não o expõe no status', async () => {
  const a = await account();
  expect(
    (await call('POST', '/auth/two-factor/setup', a.cookie, { password: 'wrong' })).statusCode,
  ).toBe(400);
  const response = await call('POST', '/auth/two-factor/setup', a.cookie, { password });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  const setup = response.json();
  expect(setup.qr_code).toMatch(/^data:image\/png;base64,/);
  const stored = await db
    .selectFrom('user_two_factor')
    .selectAll()
    .where('user_id', '=', a.id)
    .executeTakeFirstOrThrow();
  expect(stored.enabled_at).toBeNull();
  expect(stored.pending_encrypted_secret).not.toContain(setup.manual_key);
  expect((await call('GET', '/auth/two-factor', a.cookie)).body).not.toContain(setup.manual_key);
  await db
    .updateTable('user_two_factor')
    .set({ pending_expires_at: new Date(Date.now() - 1000) })
    .where('user_id', '=', a.id)
    .execute();
  const code = new TOTP({ secret: setup.manual_key }).generate();
  expect((await call('POST', '/auth/two-factor/enable', a.cookie, { code })).statusCode).toBe(409);
  expect((await call('DELETE', '/auth/two-factor/setup', a.cookie)).statusCode).toBe(200);
});
it('ativação revoga sessões antigas e só libera login depois do TOTP; códigos e desafios não podem ser reutilizados', async () => {
  const a = await account();
  const oldLogin = await call('POST', '/auth/login', '', { email: a.email, password });
  const active = await enrolled(a);
  expect((await call('GET', '/auth/me', cookie(oldLogin))).statusCode).toBe(401);
  const token = await challenge(a);
  expect((await call('GET', '/auth/me')).statusCode).toBe(401);
  // Enrollment already consumed this time step. A next-step token is within the allowed clock window.
  const nextCode = active.totp.generate({ timestamp: Date.now() + 30000 });
  const success = await call('POST', '/auth/two-factor/login', '', {
    challenge: token,
    code: nextCode,
  });
  expect(success.statusCode, success.body).toBe(200);
  expect((await call('GET', '/auth/me', cookie(success))).json().user.id).toBe(a.id);
  expect(
    (await call('POST', '/auth/two-factor/login', '', { challenge: token, code: nextCode }))
      .statusCode,
  ).toBe(401);
  const nextChallenge = await challenge(a);
  expect(
    (await call('POST', '/auth/two-factor/login', '', { challenge: nextChallenge, code: nextCode }))
      .statusCode,
  ).toBe(401);
});
it('código de recuperação funciona uma vez, é consumido atomicamente em logins concorrentes e pertence só à conta', async () => {
  const a = await enrolled(),
    b = await enrolled();
  let token = await challenge(a);
  expect(
    (await call('POST', '/auth/two-factor/login', '', { challenge: token, code: b.codes[0] }))
      .statusCode,
  ).toBe(401);
  const results = await Promise.all(
    [1, 2].map(() =>
      call('POST', '/auth/two-factor/login', '', { challenge: token, code: a.codes[0] }),
    ),
  );
  expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
  token = await challenge(a);
  expect(
    (await call('POST', '/auth/two-factor/login', '', { challenge: token, code: a.codes[0] }))
      .statusCode,
  ).toBe(401);
  expect((await call('GET', '/auth/two-factor', a.cookie)).json().recovery_codes_remaining).toBe(9);
});
it('desafios expiram, bloqueiam após cinco erros e rejeitam troca de senha após a primeira etapa', async () => {
  const a = await enrolled();
  let token = await challenge(a);
  await db
    .updateTable('auth_two_factor_challenges')
    .set({ expires_at: new Date(Date.now() - 1000) })
    .where('user_id', '=', a.id)
    .execute();
  expect(
    (await call('POST', '/auth/two-factor/login', '', { challenge: token, code: a.codes[0] }))
      .statusCode,
  ).toBe(401);
  token = await challenge(a);
  for (let i = 0; i < 5; i++)
    expect(
      (await call('POST', '/auth/two-factor/login', '', { challenge: token, code: 'INVALID-CODE' }))
        .statusCode,
    ).toBe(401);
  const stored = await db
    .selectFrom('auth_two_factor_challenges')
    .select('attempts')
    .where('user_id', '=', a.id)
    .executeTakeFirstOrThrow();
  expect(stored.attempts).toBe(5);
  expect(
    (await call('POST', '/auth/two-factor/login', '', { challenge: token, code: a.codes[0] }))
      .statusCode,
  ).toBe(401);
  token = await challenge(a);
  await db
    .updateTable('users')
    .set({ password_hash: await hashPassword('ChangedPassword123!') })
    .where('id', '=', a.id)
    .execute();
  expect(
    (await call('POST', '/auth/two-factor/login', '', { challenge: token, code: a.codes[0] }))
      .statusCode,
  ).toBe(401);
});
it('não deixa outra conta alterar o fator e exige senha e segundo fator para desativar ou renovar códigos', async () => {
  const a = await enrolled(),
    other = await account();
  expect(
    (await call('POST', '/auth/two-factor/disable', other.cookie, { password, code: a.codes[0] }))
      .statusCode,
  ).toBe(401);
  expect(
    (
      await call('POST', '/auth/two-factor/disable', a.cookie, {
        password: 'wrong',
        code: a.codes[0],
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (await call('POST', '/auth/two-factor/disable', a.cookie, { password, code: 'INVALID-CODE' }))
      .statusCode,
  ).toBe(401);
  const token = await challenge(a);
  const response = await call('POST', '/auth/two-factor/recovery-codes', a.cookie, {
    password,
    code: a.codes[0],
  });
  expect(response.statusCode, response.body).toBe(200);
  const codes = response.json().recovery_codes as string[];
  expect(
    (await call('POST', '/auth/two-factor/login', '', { challenge: token, code: a.codes[1] }))
      .statusCode,
  ).toBe(401);
  expect(
    (await call('POST', '/auth/two-factor/disable', a.cookie, { password, code: a.codes[1] }))
      .statusCode,
  ).toBe(401);
  expect(
    (await call('POST', '/auth/two-factor/disable', a.cookie, { password, code: codes[0] }))
      .statusCode,
  ).toBe(200);
  const login = await call('POST', '/auth/login', '', { email: a.email, password });
  expect(login.json().requires_two_factor).toBe(false);
  expect(cookie(login)).not.toBe('');
});
it('recuperação de senha mantém 2FA e não cria sessão autenticada por meio do link', async () => {
  const a = await enrolled(),
    token = randomBytes(32).toString('base64url');
  await db
    .insertInto('password_reset_tokens')
    .values({
      user_id: a.id,
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + 60000),
    })
    .execute();
  const reset = await call('POST', '/auth/reset-password', '', {
    token,
    password: 'NewPassword123!',
  });
  expect(reset.statusCode, reset.body).toBe(200);
  expect(reset.json().requires_two_factor).toBe(true);
  expect((await call('GET', '/auth/me')).statusCode).toBe(401);
  expect((await call('GET', '/auth/me', a.cookie)).statusCode).toBe(401);
  expect(
    (await call('POST', '/auth/login', '', { email: a.email, password: 'NewPassword123!' })).json()
      .requires_two_factor,
  ).toBe(true);
});
it('superadmin usa os mesmos fatores sem herdar acesso operacional', async () => {
  const a = await enrolled(await account(true));
  const token = await challenge(a);
  const logged = await call('POST', '/auth/two-factor/login', '', {
    challenge: token,
    code: a.codes[0],
  });
  expect(logged.statusCode, logged.body).toBe(200);
  const me = await call('GET', '/auth/me', cookie(logged));
  expect(me.json()).toMatchObject({ platform_admin: true, current_tenant_id: null, tenants: [] });
  expect((await call('GET', '/mailboxes', cookie(logged))).statusCode).toBe(403);
});
it('a proteção central impede emissão alternativa de sessão para usuário com 2FA, inclusive com sessão revogada', async () => {
  const a = await account();
  const old = await call('POST', '/auth/login', '', { email: a.email, password });
  await enrolled(a);
  const other = await account();
  for (const credentials of ['', cookie(old), other.cookie]) {
    const response = await call('POST', '/auth/qa-session-proof', credentials, { user_id: a.id });
    expect(response.statusCode, response.body).toBe(401);
    expect(cookie(response)).toBe('');
  }
  // An already authenticated, retained session may be renewed (e.g. accepting an invitation).
  expect(
    (await call('POST', '/auth/qa-session-proof', a.cookie, { user_id: a.id })).statusCode,
  ).toBe(200);
});
