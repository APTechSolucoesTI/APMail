import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { createDb, migrate } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashPassword } from '../../src/modules/auth.js';

const url = process.env.DATABASE_URL_TEST!,
  redis = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Banco de teste exclusivo obrigatório');
const db = createDb(url),
  secret = randomBytes(32).toString('base64'),
  origin = 'http://localhost:5173';
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redis,
    APP_URL: origin,
    SESSION_SECRET: secret,
    CREDENTIALS_ENCRYPTION_KEY: secret,
  }),
);
const tenant = randomUUID(),
  other = randomUUID(),
  users: string[] = [];
let ownerCookie = '',
  memberCookie = '',
  platformCookie = '',
  ownerEmail = '';
async function call(
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  cookie = '',
  payload?: unknown,
) {
  return app.inject({
    method,
    url: '/api' + path,
    headers: { origin, cookie },
    ...(payload === undefined
      ? {}
      : {
          payload: JSON.stringify(payload),
          headers: { origin, cookie, 'content-type': 'application/json' },
        }),
  });
}
async function account(role: 'owner' | 'member', platform = false) {
  const id = randomUUID(),
    email = 'company-' + id + '@qa.example',
    password = 'QaCompany123!';
  users.push(id);
  await db
    .insertInto('users')
    .values({
      id,
      email,
      full_name: 'Company QA',
      password_hash: await hashPassword(password),
      current_tenant_id: platform ? null : tenant,
    })
    .execute();
  if (platform) await db.insertInto('platform_admins').values({ user_id: id }).execute();
  else
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tenant, user_id: id, role })
      .execute();
  const login = await call('POST', '/auth/login', '', { email, password });
  expect(login.statusCode, login.body).toBe(200);
  return { cookie: String(login.headers['set-cookie']).split(';')[0]!, email };
}
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  for (const id of [tenant, other])
    await db
      .insertInto('tenants')
      .values({ id, name: 'Company QA', slug: 'company-' + id })
      .execute();
  const owner = await account('owner');
  ownerCookie = owner.cookie;
  ownerEmail = owner.email;
  memberCookie = (await account('member')).cookie;
  platformCookie = (await account('member', true)).cookie;
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
it('persists company details without replacing settings or another tenant', async () => {
  const before = await db
    .selectFrom('tenants')
    .selectAll()
    .where('id', '=', tenant)
    .executeTakeFirstOrThrow();
  const patch = await call('PATCH', '/tenant', ownerCookie, {
    company_details: {
      legal_name: 'Razão Social QA',
      cnpj: '11.222.333/0001-81',
      city: 'São Paulo',
    },
  });
  expect(patch.statusCode, patch.body).toBe(200);
  const read = await call('GET', '/tenant', ownerCookie);
  expect(read.json()).toMatchObject({
    company_details: { legal_name: 'Razão Social QA', cnpj: '11222333000181' },
    settings: before.settings,
  });
  const partial = await call('PATCH', '/tenant', ownerCookie, {
    company_details: { city: 'Campinas' },
  });
  expect(partial.statusCode, partial.body).toBe(200);
  expect(partial.json()).toMatchObject({
    company_details: { legal_name: 'Razão Social QA', cnpj: '11222333000181', city: 'Campinas' },
  });
  expect(
    await db
      .selectFrom('tenants')
      .select('company_details')
      .where('id', '=', other)
      .executeTakeFirstOrThrow(),
  ).toEqual({ company_details: {} });
});
it('enforces company management and validates company data before write or lookup', async () => {
  expect(
    (await call('PATCH', '/tenant', memberCookie, { company_details: { legal_name: 'Forbidden' } }))
      .statusCode,
  ).toBe(403);
  expect(
    (await call('GET', '/tenant/company-lookup/11222333000181', memberCookie)).statusCode,
  ).toBe(403);
  expect(
    (await call('GET', '/superadmin/company-lookup/11222333000181', ownerCookie)).statusCode,
  ).toBe(403);
  expect((await call('GET', '/tenant/company-lookup/00000000000000', ownerCookie)).statusCode).toBe(
    400,
  );
  expect(
    (await call('PATCH', '/tenant', ownerCookie, { company_details: { cnpj: '11222333000182' } }))
      .statusCode,
  ).toBe(400);
});
it('superadmin creates and edits the same registration fields without invitations for existing owner', async () => {
  const created = await call('POST', '/superadmin/tenants', platformCookie, {
    name: 'Platform Company QA',
    slug: 'company-created-' + randomUUID(),
    owner_email: ownerEmail,
    company_details: { legal_name: 'Cadastro plataforma', cnpj: '11222333000181' },
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id as string;
  expect((await call('GET', '/superadmin/tenants/' + id, platformCookie)).json()).toMatchObject({
    company_details: { legal_name: 'Cadastro plataforma', cnpj: '11222333000181' },
  });
  const changed = await call('PATCH', '/superadmin/tenants/' + id, platformCookie, {
    company_details: { city: 'Santos' },
  });
  expect(changed.statusCode, changed.body).toBe(200);
  expect((await call('GET', '/superadmin/tenants/' + id, platformCookie)).json()).toMatchObject({
    company_details: { city: 'Santos', legal_name: 'Cadastro plataforma', cnpj: '11222333000181' },
  });
});
