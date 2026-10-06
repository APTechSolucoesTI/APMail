import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sql } from 'kysely';
import { createDb, migrate } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';

const url = process.env.DATABASE_URL_TEST!,
  redis = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Banco exclusivo obrigatório.');
const db = createDb(url),
  tenant = randomUUID(),
  foreignTenant = randomUUID(),
  owner = randomUUID(),
  member = randomUUID(),
  foreign = randomUUID(),
  platform = randomUUID();
const box = randomUUID(),
  privateBox = randomUUID(),
  foreignBox = randomUUID(),
  folder = randomUUID(),
  hiddenFolder = randomUUID(),
  childFolder = randomUUID(),
  thread = randomUUID(),
  hiddenThread = randomUUID();
const origin = 'http://localhost:5173',
  secret = randomBytes(32).toString('base64');
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redis,
    APP_URL: origin,
    SESSION_SECRET: secret,
    CREDENTIALS_ENCRYPTION_KEY: secret,
    STORAGE_DIR: join(tmpdir(), 'apmail-contact-search-' + tenant),
  }),
);
const cookies = new Map<string, string>();
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  user = owner,
  body?: unknown,
) =>
  app.inject({
    method,
    url: path,
    headers: {
      origin,
      cookie: cookies.get(user) ?? '',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { payload: JSON.stringify(body) } : {}),
  });
const search = (q: string, user = member) =>
  call('GET', '/api/search?' + new URLSearchParams({ q }), user);
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Search QA', slug: 'search-' + tenant },
      { id: foreignTenant, name: 'Foreign QA', slug: 'search-' + foreignTenant },
    ])
    .execute();
  for (const [id, company, role] of [
    [owner, tenant, 'owner'],
    [member, tenant, 'member'],
    [foreign, foreignTenant, 'owner'],
    [platform, foreignTenant, 'owner'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@qa.local',
        full_name: 'QA',
        password_hash: 'session-fixture',
        current_tenant_id: company,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: company, user_id: id, role })
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
  await db.insertInto('platform_admins').values({ user_id: platform }).execute();
  for (const [id, company, name] of [
    [box, tenant, 'Visible Needle'],
    [privateBox, tenant, 'Private Needle'],
    [foreignBox, foreignTenant, 'Foreign Needle'],
  ] as const)
    await db
      .insertInto('mailboxes')
      .values({
        id,
        tenant_id: company,
        name,
        email_address: id + '@qa.local',
        username: 'qa',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        status: 'disabled',
      })
      .execute();
  await db
    .insertInto('mailbox_members')
    .values({
      mailbox_id: box,
      tenant_id: tenant,
      user_id: member,
      role: 'editor',
      restrict_to_folders: true,
    })
    .execute();
  await db
    .insertInto('folders')
    .values([
      {
        id: folder,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'Allowed Needle',
        imap_path: 'INBOX',
        special_use: 'inbox',
      },
      {
        id: hiddenFolder,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'Secret Needle Folder',
        imap_path: 'Private',
      },
      {
        id: childFolder,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'Child Needle',
        imap_path: 'INBOX/Child',
        parent_id: folder,
      },
    ])
    .execute();
  await db
    .insertInto('folder_permissions')
    .values({ tenant_id: tenant, mailbox_id: box, folder_id: folder, user_id: member })
    .execute();
  await db
    .insertInto('threads')
    .values([
      { id: thread, tenant_id: tenant, mailbox_id: box },
      { id: hiddenThread, tenant_id: tenant, mailbox_id: box },
    ])
    .execute();
  for (const [tid, fid, title, at] of [
    [thread, folder, 'Visible Áção Needle', '2026-01-01'],
    [thread, hiddenFolder, 'Secret Latest Needle', '2026-02-01'],
    [hiddenThread, hiddenFolder, 'Secret Only Needle', '2026-03-01'],
  ] as const)
    await db
      .insertInto('messages')
      .values({
        tenant_id: tenant,
        mailbox_id: box,
        thread_id: tid,
        folder_id: fid,
        message_id_header: '<' + randomUUID() + '@qa>',
        subject: title,
        body_text: title,
        direction: 'inbound',
        from_address: 'sender@qa.local',
        message_at: new Date(at),
      })
      .execute();
  await db
    .insertInto('personal_labels')
    .values([
      { tenant_id: tenant, user_id: member, name: 'My Needle', color: 'teal' },
      { tenant_id: tenant, user_id: owner, name: 'Other Needle', color: 'teal' },
    ])
    .execute();
}, 120000);
afterAll(async () => {
  await app.close();
  await db.destroy();
});
const payload = {
  name: 'Pessoa Áção Needle',
  job_title: 'Gestor',
  emails: [
    {
      email: 'one-' + tenant + '@qa.local',
      is_primary: true,
      links: [
        {
          company: { name: 'First Needle', cnpj: '' },
          address: { street: 'Rua A', city: 'São Paulo' },
          is_primary_company: true,
        },
        { company: { name: 'Second Needle', cnpj: '' }, address: null },
      ],
    },
    {
      email: 'two-' + tenant + '@qa.local',
      links: [{ company: null, address: { street: 'Rua B', city: 'Campinas' } }],
    },
  ],
  phones: [
    { number: '(11) 99999-0000', label: 'Celular', is_primary: true },
    { number: '11 3333-2222', label: 'Comercial' },
  ],
};
let contact = '';
it('salva múltiplos canais e troca os principais, incluindo empresas sem CNPJ', async () => {
  const created = await call('POST', '/api/contacts', member, payload);
  expect(created.statusCode, created.body).toBe(201);
  contact = created.json().id;
  const detail = (await call('GET', '/api/contacts/' + contact, member)).json();
  expect(detail.phones).toHaveLength(2);
  expect(detail.emails).toHaveLength(2);
  expect(detail.phone).toBe('(11) 99999-0000');
  detail.emails.forEach((e: { is_primary: boolean; links: { is_primary_company: boolean }[] }) => {
    e.is_primary = false;
    e.links.forEach((l) => {
      l.is_primary_company = false;
    });
  });
  detail.emails[1].is_primary = true;
  detail.emails[0].links[1].is_primary_company = true;
  detail.phones[0].is_primary = false;
  detail.phones[1].is_primary = true;
  delete detail.visibility;
  delete detail.mailbox_ids;
  const updated = await call('PUT', '/api/contacts/' + contact, member, detail);
  expect(updated.statusCode, updated.body).toBe(200);
  const reread = (await call('GET', '/api/contacts/' + contact, member)).json();
  expect(reread.emails[0].email).toBe(payload.emails[1]!.email);
  expect(reread.phone).toBe('11 3333-2222');
  expect(
    reread.emails
      .flatMap((e: { links: unknown[] }) => e.links)
      .find((l: { is_primary_company: boolean }) => l.is_primary_company).company.name,
  ).toBe('Second Needle');
  const rows = (await call('GET', '/api/contacts?search=Pessoa', member)).json().items;
  expect(rows.find((r: { id: string }) => r.id === contact)).toMatchObject({
    primary_email: payload.emails[1]!.email,
    primary_company: 'Second Needle',
    job_title: 'Gestor',
  });
  expect(
    await db.selectFrom('contact_companies').select('id').where('tenant_id', '=', tenant).execute(),
  ).toHaveLength(2);
});
it('preserva a regra de e-mail único e recusa múltiplos principais ou telefones duplicados', async () => {
  expect(
    (
      await call('POST', '/api/contacts', member, {
        name: 'Duplicate',
        emails: [{ email: payload.emails[0]!.email }],
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await call('POST', '/api/contacts', member, {
        ...payload,
        emails: payload.emails.map((e) => ({ ...e, is_primary: true })),
      })
    ).statusCode,
  ).toBe(400);
  expect(
    (
      await call('POST', '/api/contacts', member, {
        name: 'Phones',
        emails: [{ email: randomUUID() + '@qa.local' }],
        phones: [{ number: '(11) 99999-0000' }, { number: '11999990000' }],
      })
    ).statusCode,
  ).toBe(400);
});
it('lista e vincula somente empresas dos contatos visíveis, sem duplicar empresa sem CNPJ', async () => {
  const companies = (await call('GET', '/api/contacts/companies?search=Second', member)).json()
    .items;
  expect(companies).toHaveLength(1);
  const result = await call('POST', '/api/contacts', member, {
    name: 'Another contact',
    emails: [
      { email: randomUUID() + '@qa.local', links: [{ company: companies[0], address: null }] },
    ],
  });
  expect(result.statusCode, result.body).toBe(201);
  expect(
    await db.selectFrom('contact_companies').select('id').where('tenant_id', '=', tenant).execute(),
  ).toHaveLength(2);
  expect((await call('GET', '/api/contacts/companies', foreign)).json().items).toHaveLength(0);
});
it('busca global não revela caixas, pastas, mensagens nem etiquetas sem acesso', async () => {
  const result = await search('needle');
  expect(result.statusCode, result.body).toBe(200);
  const groups = result.json().groups,
    items = groups.flatMap((g: { items: unknown[] }) => g.items),
    text = JSON.stringify(items);
  expect(text).toContain('Visible Áção Needle');
  expect(text).not.toContain('Secret');
  expect(text).not.toContain('Private Needle');
  expect(text).not.toContain('Foreign Needle');
  expect(text).not.toContain('Other Needle');
  expect(groups.find((g: { category: string }) => g.category === 'email').items).toHaveLength(1);
  expect(groups.find((g: { category: string }) => g.category === 'folder').items).toHaveLength(2);
  expect(groups.find((g: { category: string }) => g.category === 'contact').items[0].url).toContain(
    'contactId=',
  );
  expect(
    (await search('acao')).json().groups.find((g: { category: string }) => g.category === 'email')
      .items,
  ).toHaveLength(1);
  expect(
    (await search('Secret')).json().groups.flatMap((g: { items: unknown[] }) => g.items),
  ).toHaveLength(0);
  expect(
    (await search('Secret', owner))
      .json()
      .groups.find((g: { category: string }) => g.category === 'email').items.length,
  ).toBeGreaterThan(0);
});
it('aplica a visibilidade de contato a todos os campos pesquisáveis e sugestões de empresas', async () => {
  const hidden = await call('POST', '/api/contacts', owner, {
    name: 'Secret Contact',
    visibility: 'selected',
    mailbox_ids: [privateBox],
    emails: [
      {
        email: randomUUID() + '@qa.local',
        links: [
          { company: { name: 'Hidden Company', cnpj: '' }, address: { street: 'Hidden Street' } },
        ],
      },
    ],
    phones: [{ number: '555777' }],
  });
  expect(hidden.statusCode, hidden.body).toBe(201);
  for (const term of ['Hidden', '555777'])
    expect(
      (await search(term)).json().groups.find((g: { category: string }) => g.category === 'contact')
        .items,
    ).toHaveLength(0);
  expect(
    (await call('GET', '/api/contacts/companies?search=Hidden', member)).json().items,
  ).toHaveLength(0);
  const company = (await call('GET', '/api/contacts/companies?search=Hidden', owner)).json()
    .items[0];
  expect(
    (
      await call('POST', '/api/contacts', member, {
        name: 'Forbidden company',
        emails: [{ email: randomUUID() + '@qa.local', links: [{ company, address: null }] }],
      })
    ).statusCode,
  ).toBe(404);
  expect((await call('GET', '/api/contacts/' + contact, foreign)).statusCode).toBe(404);
});
it('resultados de configurações e filas respeitam o papel, e buscas inválidas não geram wildcard', async () => {
  const memberSettings = (await search('configuracoes'))
    .json()
    .groups.find((g: { category: string }) => g.category === 'setting').items;
  expect(memberSettings.map((i: { url: string }) => i.url)).not.toContain('/settings/tenant');
  const audit = (await search('auditoria'))
    .json()
    .groups.find((g: { category: string }) => g.category === 'setting').items;
  expect(audit).toHaveLength(0);
  expect(
    (await search('auditoria', owner))
      .json()
      .groups.find((g: { category: string }) => g.category === 'setting').items,
  ).toHaveLength(1);
  const queue = (await search('a responder'))
    .json()
    .groups.find((g: { category: string }) => g.category === 'queue').items;
  expect(queue).toHaveLength(1);
  expect(queue[0].url).toContain(box);
  expect(
    (await search('%_')).json().groups.flatMap((g: { items: unknown[] }) => g.items),
  ).toHaveLength(0);
  expect((await search('a')).statusCode).toBe(400);
  expect((await search('needle', platform)).statusCode).toBe(403);
});
it('busca limita resultados por categoria e marca que há mais, sem carregar o conjunto inteiro', async () => {
  for (let i = 0; i < 7; i++)
    await call('POST', '/api/contacts', owner, {
      name: 'Limitword ' + i,
      emails: [{ email: randomUUID() + '@qa.local' }],
    });
  const group = (await search('limitword'))
    .json()
    .groups.find((g: { category: string }) => g.category === 'contact');
  expect(group.items).toHaveLength(5);
  expect(group.has_more).toBe(true);
});
it('busca telefones com ou sem formatação e respeita a privacidade de rascunhos e chats', async () => {
  for (const term of ['11999990000', '(11) 99999-0000', '1133332222'])
    expect(
      (await search(term))
        .json()
        .groups.find((g: { category: string }) => g.category === 'contact')
        .items.some((i: { id: string }) => i.id === contact),
    ).toBe(true);
  for (const [status, creator, tid, subject] of [
    ['draft', member, null, 'Channels own draft'],
    ['draft', owner, null, 'Channels private draft'],
    ['scheduled', owner, thread, 'Channels visible scheduled'],
    ['scheduled', owner, hiddenThread, 'Channels hidden scheduled'],
  ] as const)
    await db
      .insertInto('outbox')
      .values({
        tenant_id: tenant,
        mailbox_id: box,
        created_by: creator,
        thread_id: tid,
        status,
        subject,
      })
      .execute();
  const chat = randomUUID();
  await db
    .insertInto('chat_conversations')
    .values({
      id: chat,
      tenant_id: tenant,
      created_by: owner,
      type: 'group',
      name: 'Channels chat',
    })
    .execute();
  await db
    .insertInto('chat_participants')
    .values([
      { tenant_id: tenant, conversation_id: chat, user_id: member },
      { tenant_id: tenant, conversation_id: chat, user_id: owner, left_at: new Date() },
    ])
    .execute();
  const groups = (await search('Channels')).json().groups;
  expect(
    groups
      .find((g: { category: string }) => g.category === 'outbox')
      .items.map((i: { title: string }) => i.title),
  ).toEqual(expect.arrayContaining(['Channels own draft', 'Channels visible scheduled']));
  expect(groups.find((g: { category: string }) => g.category === 'outbox').items).toHaveLength(2);
  expect(groups.find((g: { category: string }) => g.category === 'chat').items).toHaveLength(1);
  expect(
    (await search('Channels', owner))
      .json()
      .groups.find((g: { category: string }) => g.category === 'chat').items,
  ).toHaveLength(0);
});
it('telefones novos contam na cota e uma falha não altera o cadastro', async () => {
  const detail = (await call('GET', '/api/contacts/' + contact, owner)).json();
  const used = (
    await sql<{
      bytes: string;
    }>`select storage_quota_usage(${tenant}::uuid)::text as bytes`.execute(db)
  ).rows[0]!.bytes;
  await sql`update tenant_storage_limits set storage_limit_bytes=${used}::bigint where tenant_id=${tenant}::uuid`.execute(
    db,
  );
  try {
    const result = await call('PUT', '/api/contacts/' + contact, owner, {
      ...detail,
      phones: [...detail.phones, { number: '555-222-111', label: 'Extra' }],
    });
    expect(result.statusCode, result.body).toBe(409);
    expect((await call('GET', '/api/contacts/' + contact, owner)).json().phones).toHaveLength(2);
  } finally {
    await sql`update tenant_storage_limits set storage_limit_bytes=null where tenant_id=${tenant}::uuid`.execute(
      db,
    );
  }
});
it('cadastra empresa independente, pesquisa no mesmo campo e vincula sem duplicar', async () => {
  const created = await call('POST', '/api/companies', member, {
    name: 'Razão Árvore',
    trade_name: 'Fantasia Directory',
    cnpj: '12.345.678/0001-99',
    addresses: [
      { cep: '01001000', street: 'Rua QA' },
      { cep: '20000000', street: 'Rua B' },
    ],
  });
  expect(created.statusCode, created.body).toBe(201);
  const companyId = created.json().id;
  for (const term of [
    'razao arvore',
    'Fantasia Directory',
    '12.345.678/0001-99',
    '12345678000199',
  ]) {
    const result = await call(
      'GET',
      '/api/companies?' + new URLSearchParams({ search: term }),
      member,
    );
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json().items.some((r: { id: string }) => r.id === companyId)).toBe(true);
  }
  const company = (await call('GET', '/api/companies/' + companyId, member)).json();
  expect(company.addresses).toHaveLength(2);
  expect(company.visibility).toBe('all');
  const linked = await call('POST', '/api/contacts', member, {
    name: 'Contato Directory',
    emails: [{ email: randomUUID() + '@qa.local', links: [{ company }] }],
  });
  expect(linked.statusCode, linked.body).toBe(201);
  expect(
    (
      await call('POST', '/api/companies', member, {
        name: 'Duplicate CNPJ',
        cnpj: '12345678000199',
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await call('PUT', '/api/companies/' + companyId, member, {
        ...company,
        name: 'Razão revisada',
        visibility: undefined,
        mailbox_ids: undefined,
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await call('GET', '/api/contacts/' + linked.json().id, member)).json().emails[0].links[0]
      .company.name,
  ).toBe('Razão revisada');
  expect((await call('DELETE', '/api/companies/' + companyId, owner)).statusCode).toBe(409);
  expect(
    (await search('Razão revisada'))
      .json()
      .groups.find((g: { category: string }) => g.category === 'company').items[0].url,
  ).toContain('companyId=');
});
it('personaliza visibilidade de empresas com controle administrativo e isolamento de tenant', async () => {
  const hidden = await call('POST', '/api/companies', owner, {
    name: 'Directory Hidden',
    visibility: 'selected',
    mailbox_ids: [privateBox],
  });
  expect(hidden.statusCode, hidden.body).toBe(201);
  const id = hidden.json().id;
  expect((await call('GET', '/api/companies/' + id, member)).statusCode).toBe(404);
  expect((await call('GET', '/api/companies/' + id, foreign)).statusCode).toBe(404);
  expect(
    (await call('GET', '/api/companies?search=Directory Hidden', member)).json().items,
  ).toHaveLength(0);
  expect(
    (await search('Directory Hidden'))
      .json()
      .groups.find((g: { category: string }) => g.category === 'company').items,
  ).toHaveLength(0);
  expect(
    (await call('POST', '/api/companies', member, { name: 'Not allowed', visibility: 'all' }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await call('POST', '/api/contacts', member, {
        name: 'Reference hidden',
        emails: [
          {
            email: randomUUID() + '@qa.local',
            links: [{ company: { id, name: 'Directory Hidden' } }],
          },
        ],
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call('PUT', '/api/companies/' + id, owner, {
        name: 'Directory Hidden',
        visibility: 'selected',
        mailbox_ids: [box],
      })
    ).statusCode,
  ).toBe(200);
  expect((await call('GET', '/api/companies/' + id, member)).statusCode).toBe(200);
  expect((await call('DELETE', '/api/companies/' + id, owner)).statusCode).toBe(200);
});
it('contato sem empresa aceita endereço avulso e mantém unicidade do e-mail', async () => {
  const email = randomUUID() + '@qa.local',
    body = {
      name: 'Sem empresa',
      emails: [{ email, links: [{ address: { cep: '01001000', street: 'Endereço avulso' } }] }],
    };
  const created = await call('POST', '/api/contacts', member, body);
  expect(created.statusCode, created.body).toBe(201);
  const detail = (await call('GET', '/api/contacts/' + created.json().id, member)).json();
  expect(detail.emails[0].links[0].company).toBeNull();
  expect(detail.emails[0].links[0].address.street).toBe('Endereço avulso');
  expect(detail.visibility).toBe('all');
  expect((await call('POST', '/api/contacts', member, body)).statusCode).toBe(409);
});
it('admin gerencia contatos mesmo antes de conectar caixas, sem liberar o membro sem caixas', async () => {
  await db
    .updateTable('mailboxes')
    .set({ deleted_at: new Date() })
    .where('tenant_id', '=', tenant)
    .execute();
  try {
    expect((await call('GET', '/api/contacts/' + contact, owner)).statusCode).toBe(200);
    expect((await call('GET', '/api/contacts/' + contact, member)).statusCode).toBe(404);
    expect((await call('GET', '/api/companies', owner)).statusCode).toBe(200);
    expect((await call('GET', '/api/contacts', member)).json().items).toHaveLength(0);
  } finally {
    await db
      .updateTable('mailboxes')
      .set({ deleted_at: null })
      .where('tenant_id', '=', tenant)
      .execute();
  }
});
