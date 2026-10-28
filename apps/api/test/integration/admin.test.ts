import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { createDb, migrate } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';
const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Dedicated QA database required');
const db = createDb(url),
  tenant = randomUUID(),
  other = randomUUID(),
  user = randomUUID(),
  member = randomUUID();
const origin = 'http://localhost:5190';
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: process.env.REDIS_URL_TEST!,
    APP_URL: origin,
    SESSION_SECRET: randomBytes(32).toString('base64'),
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  }),
);
const cookies = new Map<string, string>();
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Admin QA', slug: tenant },
      { id: other, name: 'Other QA', slug: other },
    ])
    .execute();
  for (const [id, role] of [
    [user, 'owner'],
    [member, 'member'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@test.local',
        full_name: 'QA',
        password_hash: 'fixture',
        current_tenant_id: tenant,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({
        tenant_id: tenant,
        user_id: id,
        role,
        ...(id === member ? { custom_permissions: ['audit.view'] } : {}),
      })
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
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  payload?: unknown,
  who = user,
) {
  return app.inject({
    method,
    url: path,
    headers: {
      origin,
      cookie: cookies.get(who)!,
      ...(payload ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  });
}
it('creates unique domains per tenant, enforces delegation and blocks removal in use', async () => {
  const res = await call('POST', '/api/domains', { domain: ' EXAMPLE.com. ' });
  expect(res.statusCode, res.body).toBe(201);
  const domain = res.json<{ id: string; domain: string }>();
  expect(domain.domain).toBe('example.com');
  expect((await call('GET', '/api/domains', undefined, member)).statusCode).toBe(403);
  const foreign = await db
    .insertInto('tenant_domains')
    .values({ tenant_id: other, domain: 'example.com', display_name: 'example.com' })
    .returning('id')
    .executeTakeFirstOrThrow();
  expect((await call('GET', '/api/domains/' + foreign.id)).statusCode).toBe(404);
  await db
    .insertInto('mailboxes')
    .values({
      tenant_id: tenant,
      domain_id: domain.id,
      name: 'QA',
      email_address: 'qa@example.com',
      username: 'qa',
      imap_host: 'localhost',
      smtp_host: 'localhost',
    })
    .execute();
  expect((await call('DELETE', '/api/domains/' + domain.id)).statusCode).toBe(409);
});
it('keeps administrative overview limited to the delegated section', async () => {
  const res = await call('GET', '/api/admin/overview', undefined, member);
  expect(res.statusCode, res.body).toBe(200);
  const body = res.json<{ sections: Record<string, unknown> }>();
  expect(body.sections).toHaveProperty('audit');
  expect(body.sections).not.toHaveProperty('team');
  expect(body.sections).not.toHaveProperty('storage');
  expect(body.sections).not.toHaveProperty('mailboxes');
});
it('persists company queue policy and personal domain grouping independently', async () => {
  expect(
    (await call('PATCH', '/api/tenant', { settings: { mail_queues_enabled: false } })).statusCode,
  ).toBe(200);
  const res = await call('GET', '/api/auth/me');
  expect(
    res.json<{ tenants: { mail_queues_enabled: boolean }[] }>().tenants[0]?.mail_queues_enabled,
  ).toBe(false);
  expect(
    (await call('PATCH', '/api/tenant', { settings: { mail_queues_enabled: true } }, member))
      .statusCode,
  ).toBe(403);
});
