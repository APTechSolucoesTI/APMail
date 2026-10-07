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
const firstCompany = randomUUID(),
  secondCompany = randomUUID();
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
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
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
      { tenant_id: tenant, user_id: member, name: 'My Needle', color: '#CCFBF1' },
      { tenant_id: tenant, user_id: owner, name: 'Other Needle', color: '#CCFBF1' },
    ])
    .execute();
  await db
    .insertInto('contact_companies')
    .values([
      {
        id: firstCompany,
        tenant_id: tenant,
        name: 'First Needle',
        addresses: JSON.stringify([{ street: 'Rua A', city: 'São Paulo' }]),
      },
      { id: secondCompany, tenant_id: tenant, name: 'Second Needle' },
    ])
    .execute();
}, 120000);
afterAll(async () => {
  await app.close();
  await db.destroy();
});
it('etiquetas globais compartilham aplicação e contam somente conversas visíveis', async () => {
  const name = 'Global QA ' + randomUUID().slice(0, 8);
  expect(
    (await call('POST', '/api/labels', member, { name, color: '#123456', scope: 'tenant' }))
      .statusCode,
  ).toBe(403);
  const created = await call('POST', '/api/labels', owner, {
    name,
    color: '#123456',
    scope: 'tenant',
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id;
  expect((await call('PATCH', '/api/labels/' + id, member, { color: '#FFFFFF' })).statusCode).toBe(
    403,
  );
  expect((await call('DELETE', '/api/labels/' + id, member)).statusCode).toBe(403);
  for (const tid of [thread, hiddenThread])
    expect(
      (
        await call('PUT', '/api/threads/' + tid + '/labels', owner, {
          label_ids: [],
          global_add: [id],
        })
      ).statusCode,
    ).toBe(200);
  const list = await call('GET', '/api/labels', member);
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().find((l: { id: string }) => l.id === id)).toMatchObject({
    scope: 'tenant',
    thread_count: 1,
  });
  const foreignList = (await call('GET', '/api/labels', foreign)).json();
  expect(foreignList.some((l: { id: string }) => l.id === id)).toBe(false);
  expect((await call('GET', '/api/threads/' + thread, member)).json().labels).toEqual(
    expect.arrayContaining([expect.objectContaining({ id, scope: 'tenant' })]),
  );
  const personal = await call('POST', '/api/labels', member, { name, color: '#000000' });
  expect(personal.statusCode, personal.body).toBe(201);
  const pid = personal.json().id;
  expect(
    (await call('PUT', '/api/threads/' + thread + '/labels', member, { label_ids: [pid] }))
      .statusCode,
  ).toBe(200);
  expect((await call('GET', '/api/threads/' + thread, member)).json().labels).toHaveLength(2);
  expect(
    (await call('GET', '/api/threads/' + thread, owner))
      .json()
      .labels.map((l: { id: string }) => l.id),
  ).toEqual([id]);
  expect((await call('PATCH', '/api/labels/' + pid, owner, { name: ' чужой' })).statusCode).toBe(
    404,
  );
  expect((await call('PATCH', '/api/labels/' + pid, member, { scope: 'tenant' })).statusCode).toBe(
    409,
  );
  const second = await call('POST', '/api/labels', owner, {
    name: name + ' 2',
    color: '#ABCDEF',
    scope: 'tenant',
  });
  expect(second.statusCode).toBe(201);
  const sid = second.json().id;
  const concurrent = await Promise.all([
    call('PUT', '/api/threads/' + thread + '/labels', member, {
      label_ids: [pid],
      global_add: [sid],
    }),
    call('PUT', '/api/threads/' + thread + '/labels', owner, {
      label_ids: [],
      global_remove: [id],
    }),
  ]);
  expect(concurrent.map((r) => r.statusCode)).toEqual([200, 200]);
  const selected = (await call('GET', '/api/threads/' + thread, member))
    .json()
    .labels.map((l: { id: string }) => l.id);
  expect(selected).toEqual(expect.arrayContaining([pid, sid]));
  expect(selected).not.toContain(id);
  expect(
    (
      await call('POST', '/api/mailboxes/' + box + '/threads/bulk', member, {
        thread_ids: [thread],
        action: 'labels',
        label_ids: [pid],
        global_remove: [sid],
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await call('GET', '/api/threads/' + thread, member))
      .json()
      .labels.map((l: { id: string }) => l.id),
  ).toEqual([pid]);
  expect(
    (await call('POST', '/api/labels', member, { name: 'invalid', color: 'url(javascript:1)' }))
      .statusCode,
  ).toBe(400);
  expect(
    (
      await call('POST', '/api/labels', owner, {
        name: name.toUpperCase(),
        color: '#123456',
        scope: 'tenant',
      })
    ).statusCode,
  ).toBe(409);
});

it('troca de remetente preserva anexos, CID, medição e rascunho em falha de cota', async () => {
  const boundary = 'QA' + randomUUID(),
    binary = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF7sAAAAASUVORK5CYII=',
      'base64',
    );
  const uploadResponse = await app.inject({
    method: 'POST',
    url: '/api/uploads?mailbox_id=' + box,
    headers: {
      origin,
      cookie: cookies.get(owner)!,
      'content-type': 'multipart/form-data; boundary=' + boundary,
    },
    payload: Buffer.concat([
      Buffer.from(
        '--' +
          boundary +
          '\r\nContent-Disposition: form-data; name="file"; filename="imagem.png"\r\nContent-Type: image/png\r\n\r\n',
      ),
      binary,
      Buffer.from('\r\n--' + boundary + '--\r\n'),
    ]),
  });
  expect(uploadResponse.statusCode, uploadResponse.body).toBe(201);
  const uploadId = uploadResponse.json().id;
  const draft = await call('POST', '/api/outbox', owner, {
    mailbox_id: box,
    kind: 'new',
    to_addresses: [{ address: 'dest@qa.local', name: 'Contato' }],
    subject: 'Rascunho QA',
    body_html: `<p>Texto preservado</p><img src="cid:${uploadId}@apmail.local" data-apmail-upload="${uploadId}" alt="QA">`,
    attachments: [{ source: 'upload', upload_id: uploadId, inline: true }],
  });
  expect(draft.statusCode, draft.body).toBe(201);
  const id = draft.json().id;
  const switched = await call('PATCH', '/api/outbox/' + id, owner, { mailbox_id: privateBox });
  expect(switched.statusCode, switched.body).toBe(200);
  const read = (await call('GET', '/api/outbox/' + id, owner)).json();
  expect(read.mailbox_id).toBe(privateBox);
  expect(read.subject).toBe('Rascunho QA');
  expect(read.body_html).toContain('cid:' + uploadId + '@apmail.local');
  expect(read.attachments[0].inline).toBe(true);
  const preview = await call('GET', '/api/uploads/' + uploadId + '/image', owner);
  expect(preview.statusCode, preview.body).toBe(200);
  expect(preview.rawPayload.equals(binary)).toBe(true);
  expect(read.attachment_metadata).toHaveLength(1);
  expect(
    (
      await db
        .selectFrom('uploads')
        .select('mailbox_id')
        .where('id', '=', uploadId)
        .executeTakeFirstOrThrow()
    ).mailbox_id,
  ).toBe(privateBox);
  const asset = await db
    .selectFrom('storage_assets as a')
    .innerJoin('storage_asset_refs as ref', 'ref.asset_id', 'a.id')
    .select(['a.mailbox_id', 'a.present_bytes'])
    .where('ref.source_id', '=', uploadId)
    .executeTakeFirstOrThrow();
  expect(asset.mailbox_id).toBe(privateBox);
  expect(Number(asset.present_bytes)).toBe(binary.length);
  await sql`update mailbox_storage_limits set allocated_bytes=0 where mailbox_id=${box}::uuid`.execute(
    db,
  );
  try {
    const failed = await call('PATCH', '/api/outbox/' + id, owner, { mailbox_id: box });
    expect(failed.statusCode, failed.body).toBe(409);
    expect((await call('GET', '/api/outbox/' + id, owner)).json().mailbox_id).toBe(privateBox);
    expect(
      (
        await db
          .selectFrom('uploads')
          .select('mailbox_id')
          .where('id', '=', uploadId)
          .executeTakeFirstOrThrow()
      ).mailbox_id,
    ).toBe(privateBox);
    expect(
      (
        await db
          .selectFrom('storage_assets as a')
          .innerJoin('storage_asset_refs as ref', 'ref.asset_id', 'a.id')
          .select('a.mailbox_id')
          .where('ref.source_id', '=', uploadId)
          .executeTakeFirstOrThrow()
      ).mailbox_id,
    ).toBe(privateBox);
  } finally {
    await sql`update mailbox_storage_limits set allocated_bytes=null where mailbox_id=${box}::uuid`.execute(
      db,
    );
  }
  expect((await call('PATCH', '/api/outbox/' + id, member, { mailbox_id: box })).statusCode).toBe(
    403,
  );
});
const payload = {
  name: 'Pessoa Áção Needle',
  job_title: 'Gestor',
  companies: [
    { id: firstCompany, name: 'First Needle', is_primary: true },
    { id: secondCompany, name: 'Second Needle' },
  ],
  emails: [
    { email: 'one-' + tenant + '@qa.local', is_primary: true },
    { email: 'two-' + tenant + '@qa.local' },
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
  detail.emails.forEach((e: { is_primary: boolean }) => {
    e.is_primary = false;
  });
  detail.emails[1].is_primary = true;
  detail.companies.forEach((company: { id: string; is_primary: boolean }) => {
    company.is_primary = company.id === secondCompany;
  });
  detail.phones[0].is_primary = false;
  detail.phones[1].is_primary = true;
  delete detail.visibility;
  delete detail.mailbox_ids;
  const updated = await call('PUT', '/api/contacts/' + contact, member, detail);
  expect(updated.statusCode, updated.body).toBe(200);
  const reread = (await call('GET', '/api/contacts/' + contact, member)).json();
  expect(reread.emails[0].email).toBe(payload.emails[1]!.email);
  expect(reread.phone).toBe('11 3333-2222');
  expect(reread.companies.find((company: { is_primary: boolean }) => company.is_primary).name).toBe(
    'Second Needle',
  );
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
    emails: [{ email: randomUUID() + '@qa.local' }],
    companies: [companies[0]],
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
it('agenda completa é compartilhada na tenância e não concede mensagens restritas', async () => {
  const company = (
    await call('POST', '/api/companies', owner, {
      name: 'Shared Company',
      addresses: [{ street: 'Rua compartilhada' }],
    })
  ).json();
  const created = await call('POST', '/api/contacts', owner, {
    name: 'Shared Contact',
    emails: [{ email: randomUUID() + '@qa.local' }],
    companies: [{ id: company.id, name: 'Shared Company' }],
    phones: [{ number: '555777' }],
  });
  expect(created.statusCode, created.body).toBe(201);
  expect((await call('GET', '/api/contacts/' + created.json().id, member)).statusCode).toBe(200);
  for (const term of ['Shared Company', '555777'])
    expect(
      (await search(term)).json().groups.find((g: { category: string }) => g.category === 'contact')
        .items.length,
    ).toBeGreaterThan(0);
  expect((await call('GET', '/api/contacts/' + created.json().id, foreign)).statusCode).toBe(404);
  expect(
    (await search('Secret')).json().groups.flatMap((g: { items: unknown[] }) => g.items),
  ).toHaveLength(0);
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
    emails: [{ email: randomUUID() + '@qa.local' }],
    companies: [company],
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
    (await call('GET', '/api/contacts/' + linked.json().id, member)).json().companies[0].name,
  ).toBe('Razão revisada');
  expect((await call('DELETE', '/api/companies/' + companyId, owner)).statusCode).toBe(409);
  expect(
    (await search('Razão revisada'))
      .json()
      .groups.find((g: { category: string }) => g.category === 'company').items[0].url,
  ).toContain('companyId=');
});
it('empresas são compartilhadas com membros da tenância e isoladas das demais', async () => {
  const created = await call('POST', '/api/companies', member, {
    name: 'Directory Shared',
    addresses: [{ street: 'Endereço único' }],
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id;
  expect((await call('GET', '/api/companies/' + id, owner)).statusCode).toBe(200);
  expect((await call('GET', '/api/companies/' + id, foreign)).statusCode).toBe(404);
  expect(
    (await call('GET', '/api/companies?search=Directory Shared', member)).json().items,
  ).toHaveLength(1);
  expect((await call('DELETE', '/api/companies/' + id, member)).statusCode).toBe(403);
  expect((await call('DELETE', '/api/companies/' + id, owner)).statusCode).toBe(200);
});

it('contato sem empresa não recebe endereço e conserva unicidade do e-mail', async () => {
  const email = randomUUID() + '@qa.local',
    body = { name: 'Sem empresa', emails: [{ email }] };
  const created = await call('POST', '/api/contacts', member, body);
  expect(created.statusCode, created.body).toBe(201);
  const detail = (await call('GET', '/api/contacts/' + created.json().id, member)).json();
  expect(detail.companies).toHaveLength(0);
  expect(detail.emails[0].links).toHaveLength(0);
  expect(detail).not.toHaveProperty('addresses');
  expect((await call('POST', '/api/contacts', member, body)).statusCode).toBe(409);
  expect(
    (
      await call('POST', '/api/contacts', member, {
        ...body,
        emails: [{ email: randomUUID() + '@qa.local', links: [{ address: { street: 'Avulso' } }] }],
      })
    ).statusCode,
  ).toBe(400);
});

it('agenda também é acessível a membros sem caixas', async () => {
  await db
    .updateTable('mailboxes')
    .set({ deleted_at: new Date() })
    .where('tenant_id', '=', tenant)
    .execute();
  try {
    expect((await call('GET', '/api/contacts/' + contact, owner)).statusCode).toBe(200);
    expect((await call('GET', '/api/contacts/' + contact, member)).statusCode).toBe(200);
    expect((await call('GET', '/api/companies', owner)).statusCode).toBe(200);
    expect((await call('GET', '/api/contacts', member)).json().total).toBeGreaterThan(0);
  } finally {
    await db
      .updateTable('mailboxes')
      .set({ deleted_at: null })
      .where('tenant_id', '=', tenant)
      .execute();
  }
});

it('apelidos são privados por usuário, inclusive em busca e sugestões', async () => {
  const request = (user: string, value: string) =>
    app.inject({
      method: 'PATCH',
      url: '/api/contacts/' + contact + '/nickname',
      headers: { origin, cookie: cookies.get(user)! },
      payload: { nickname: value },
    });
  expect((await request(member, 'Meu Ápelido')).statusCode).toBe(200);
  expect((await request(owner, 'Outro Particular')).statusCode).toBe(200);
  expect((await call('GET', '/api/contacts/' + contact, member)).json().nickname).toBe(
    'Meu Ápelido',
  );
  expect((await call('GET', '/api/contacts/' + contact, owner)).json().nickname).toBe(
    'Outro Particular',
  );
  expect(
    (await search('meu apelido', member))
      .json()
      .groups.find((g: { category: string }) => g.category === 'contact').items,
  ).toHaveLength(1);
  expect(
    (await search('meu apelido', owner))
      .json()
      .groups.find((g: { category: string }) => g.category === 'contact').items,
  ).toHaveLength(0);
  const suggestions = await call(
    'GET',
    '/api/mailboxes/' + box + '/address-suggestions?q=meu%20apelido',
    member,
  );
  expect(suggestions.statusCode, suggestions.body).toBe(200);
  expect(suggestions.json()[0].nickname).toBe('Meu Ápelido');
  expect(suggestions.json()[0].company_name).toBeTruthy();
  expect(suggestions.json().map((a: { address: string }) => a.address)).toEqual(
    expect.arrayContaining(payload.emails.map((e) => e.email)),
  );
});
it('histórico retorna somente pastas permitidas, sem ampliar acesso pela agenda', async () => {
  const historyContact = await call('POST', '/api/contacts', owner, {
    name: 'Remetente de histórico',
    emails: [{ email: 'sender@qa.local' }],
  });
  expect(historyContact.statusCode).toBe(201);
  const result = await call(
    'GET',
    '/api/contacts/' + historyContact.json().id + '/history',
    member,
  );
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().items).toHaveLength(1);
  expect(result.body).toContain('Visible Áção Needle');
  expect(result.body).not.toContain('Secret');
  expect(result.json().total).toBe(1);
});
