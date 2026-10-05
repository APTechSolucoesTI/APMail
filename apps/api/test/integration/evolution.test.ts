import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { createDb, migrate, userCanReadThread, userCanReadFolder } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';
import { Redis } from 'ioredis';
const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Banco de teste exclusivo obrigatório.');
const suffix = randomUUID(),
  tenant = randomUUID(),
  otherTenant = randomUUID(),
  owner = randomUUID(),
  member = randomUUID(),
  global = randomUUID(),
  foreign = randomUUID(),
  box = randomUUID(),
  otherBox = randomUUID(),
  allowed = randomUUID(),
  hidden = randomUUID(),
  thread = randomUUID();
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
    STORAGE_DIR: join(tmpdir(), 'apmail-evolution-' + suffix),
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
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Evolução QA', slug: 'evo-' + suffix },
      { id: otherTenant, name: 'Outra QA', slug: 'evo-other-' + suffix },
    ])
    .execute();
  for (const [id, company, role] of [
    [owner, tenant, 'owner'],
    [member, tenant, 'member'],
    [global, otherTenant, 'owner'],
    [foreign, otherTenant, 'owner'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@apmail.local',
        full_name: 'QA ' + id,
        password_hash: 'fixture-session-only',
        current_tenant_id: company,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: company, user_id: id, role })
      .execute();
    await db.insertInto('user_preferences').values({ user_id: id }).execute();
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
  await db.insertInto('platform_admins').values({ user_id: global }).execute();
  for (const id of [box, otherBox])
    await db
      .insertInto('mailboxes')
      .values({
        id,
        tenant_id: tenant,
        name: 'Caixa ' + id,
        email_address: id + '@apmail.local',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        username: 'qa',
        status: 'active',
      })
      .execute();
  await db
    .insertInto('mailbox_members')
    .values({ tenant_id: tenant, mailbox_id: box, user_id: member, role: 'viewer' })
    .execute();
  await db
    .insertInto('folders')
    .values([
      {
        id: allowed,
        tenant_id: tenant,
        mailbox_id: box,
        name: 'Inbox',
        imap_path: 'INBOX',
        special_use: 'inbox',
      },
      { id: hidden, tenant_id: tenant, mailbox_id: box, name: 'Oculta', imap_path: 'Oculta' },
    ])
    .execute();
  await db
    .insertInto('threads')
    .values({
      id: thread,
      tenant_id: tenant,
      mailbox_id: box,
      subject: 'Assunto secreto',
      queue_status: 'to_reply',
      last_inbound_at: new Date(Date.now() - 86400000),
    })
    .execute();
  for (const [folder, subject, at] of [
    [allowed, 'Assunto autorizado', new Date(Date.now() - 86400000)],
    [hidden, 'Assunto secreto', new Date()],
  ] as const)
    await db
      .insertInto('messages')
      .values({
        tenant_id: tenant,
        mailbox_id: box,
        thread_id: thread,
        folder_id: folder,
        message_id_header: '<' + randomUUID() + '@apmail.local>',
        message_at: at,
        subject,
        from_address: 'cliente@apmail.local',
        direction: 'inbound',
        body_text: 'Texto QA',
        snippet: 'QA',
      })
      .execute();
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
let contact = '';
it('armazenamento soma conteúdo UTF-8 e arquivos únicos, incluindo dados retidos, sem duplicar MIME', async () => {
  const company = randomUUID(),
    storedBox = randomUUID(),
    storedThread = randomUUID();
  await db
    .insertInto('tenants')
    .values({ id: company, name: 'Armazenaménto QA', slug: 'storage-' + suffix })
    .execute();
  await db
    .insertInto('tenant_members')
    .values({ tenant_id: company, user_id: owner, role: 'owner' })
    .execute();
  await db
    .insertInto('mailboxes')
    .values(
      Array.from({ length: 12 }, (_, i) => ({
        id: i === 0 ? storedBox : randomUUID(),
        tenant_id: company,
        name: i === 0 ? 'Arquivo QA' : 'Vazia ' + i,
        email_address: `storage-${suffix}-${i}@apmail.local`,
        username: 'qa',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        deleted_at: i === 0 ? new Date() : null,
      })),
    )
    .execute();
  await db
    .insertInto('threads')
    .values({ id: storedThread, tenant_id: company, mailbox_id: storedBox })
    .execute();
  const html = '<p>Olá</p>',
    text = 'ação',
    draft = 'rascunho',
    signature = '<p>Nome</p>';
  const message = await db
    .insertInto('messages')
    .values({
      tenant_id: company,
      mailbox_id: storedBox,
      thread_id: storedThread,
      body_html: html,
      body_text: text,
      size_bytes: 1000000,
      deleted_at: new Date(),
      direction: 'inbound',
      message_at: new Date(),
      message_id_header: '<' + randomUUID() + '@storage.test>',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('outbox')
    .values({ tenant_id: company, mailbox_id: storedBox, created_by: owner, body_html: draft })
    .execute();
  const path = company + '/unique-file';
  // Sent upload metadata survives after the source file is removed; the attachment copy counts.
  await db
    .insertInto('uploads')
    .values({
      tenant_id: company,
      user_id: owner,
      filename: 'consumido',
      content_type: 'image/png',
      storage_path: company + '/consumed',
      size_bytes: 100000,
      consumed_at: new Date(),
    })
    .execute();
  await db
    .insertInto('attachments')
    .values(
      [0, 1].map(() => ({
        tenant_id: company,
        mailbox_id: storedBox,
        message_id: message.id,
        filename: 'anexo',
        storage_path: path,
        size_bytes: 2048,
      })),
    )
    .execute();
  await db
    .insertInto('uploads')
    .values([
      {
        tenant_id: company,
        user_id: owner,
        filename: 'mesmo arquivo',
        content_type: 'image/png',
        storage_path: path,
        size_bytes: 2048,
      },
      {
        tenant_id: company,
        user_id: owner,
        filename: 'compartilhado',
        content_type: 'image/png',
        storage_path: company + '/upload',
        size_bytes: 512,
      },
    ])
    .execute();
  await db
    .insertInto('signature_images')
    .values({
      tenant_id: company,
      user_id: owner,
      storage_path: company + '/signature',
      size_bytes: 1024,
      width: 10,
      height: 10,
      content_type: 'image/png',
    })
    .execute();
  await db
    .insertInto('signatures')
    .values({ tenant_id: company, user_id: owner, name: 'QA', body_html: signature })
    .execute();
  const url = '/api/superadmin/storage?tenant_id=' + company;
  expect((await call('GET', url, owner)).statusCode).toBe(403);
  const response = await call('GET', url, global);
  expect(response.statusCode, response.body).toBe(200);
  const contentBytes = Buffer.byteLength(html + text + draft),
    sharedBytes = 1536 + Buffer.byteLength(signature);
  const data = response.json();
  expect(data.total).toBe(1);
  expect((await call('GET', url + '&search=ARMAZENAMENTO', global)).json().total).toBe(1);
  expect(data.items[0]).toMatchObject({
    tenant_id: company,
    messages: 1,
    content_bytes: contentBytes,
    attachment_bytes: 2048,
    shared_bytes: sharedBytes,
    total_bytes: contentBytes + 2048 + sharedBytes,
    source_mail_bytes: 1000000,
  });
  expect(data.summary.total_bytes).toBe(data.items[0].total_bytes);
  const first = (await call('GET', url + '&scope=mailboxes', global)).json();
  const second = (await call('GET', url + '&scope=mailboxes&page=2', global)).json();
  expect(first.total).toBe(12);
  expect(first.items).toHaveLength(10);
  expect(second.items).toHaveLength(2);
  expect(second.summary).toEqual(first.summary);
  expect(first.items[0]).toMatchObject({
    id: storedBox,
    retained_deleted: true,
    total_bytes: contentBytes + 2048,
    shared_bytes: 0,
  });
  expect(first.summary.total_bytes + data.summary.shared_bytes).toBe(data.summary.total_bytes);
  const searched = (await call('GET', url + '&scope=mailboxes&search=arquivo', global)).json();
  expect(searched.total).toBe(1);
  expect(searched.items[0].id).toBe(storedBox);
  expect((await call('GET', url + '&sort=secret_column', global)).statusCode).toBe(400);
  expect((await call('GET', '/api/superadmin/storage?tenant_id=invalid', global)).statusCode).toBe(
    400,
  );
  const empty = (
    await call('GET', '/api/superadmin/storage?tenant_id=' + otherTenant, global)
  ).json();
  expect(empty.items[0].total_bytes).toBe(0);
});
it('cria contato completo com vários e-mails e vínculos, isolado por tenant', async () => {
  const result = await call('POST', '/api/contacts', member, {
    name: 'José QA',
    emails: [
      {
        email: ' Pessoa-' + suffix + '@apmail.local ',
        links: [
          {
            company: { name: 'Empresa QA', cnpj: '12345678000190' },
            address: { cep: '01001000', street: 'Praça da Sé' },
          },
        ],
      },
      { email: 'outro-' + suffix + '@apmail.local' },
    ],
  });
  expect(result.statusCode, result.body).toBe(201);
  contact = result.json().id;
  const read = await call('GET', '/api/contacts/' + contact, member);
  expect(read.statusCode).toBe(200);
  expect(read.json().emails).toHaveLength(2);
  expect(read.body).toContain('Praça da Sé');
  expect((await call('GET', '/api/contacts/' + contact, foreign)).statusCode).toBe(404);
  expect((await call('GET', '/api/contacts/' + contact, global)).statusCode).toBe(403);
});
it('impede duplicidade normalizada, inclusive criação concorrente', async () => {
  const email = 'race-' + suffix + '@apmail.local';
  const results = await Promise.all([
    call('POST', '/api/contacts', member, { name: 'Contato 1', emails: [{ email }] }),
    call('POST', '/api/contacts', member, {
      name: 'Contato 2',
      emails: [{ email: email.toUpperCase() }],
    }),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  const rows = await db
    .selectFrom('contact_emails')
    .select('id')
    .where('tenant_id', '=', tenant)
    .where('email', '=', email)
    .execute();
  expect(rows).toHaveLength(1);
});
it('admin controla exibição e usuário vê o contato inteiro por uma caixa autorizada', async () => {
  const detail = (await call('GET', '/api/contacts/' + contact)).json();
  expect(
    (
      await call('PUT', '/api/contacts/' + contact, member, {
        ...detail,
        visibility: 'selected',
        mailbox_ids: [box],
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await call('PUT', '/api/contacts/' + contact, owner, {
        ...detail,
        visibility: 'selected',
        mailbox_ids: [otherBox],
      })
    ).statusCode,
  ).toBe(200);
  expect((await call('GET', '/api/contacts/' + contact, member)).statusCode).toBe(404);
  const duplicate = await call('POST', '/api/contacts', member, {
    name: 'Outro nome',
    emails: [{ email: detail.emails[0].email }],
  });
  expect(duplicate.statusCode).toBe(409);
  expect(duplicate.body).not.toContain('José');
  expect(
    (
      await call('PUT', '/api/contacts/' + contact, owner, {
        ...detail,
        visibility: 'selected',
        mailbox_ids: [box, otherBox],
      })
    ).statusCode,
  ).toBe(200);
  expect((await call('GET', '/api/contacts/' + contact, member)).json().emails).toHaveLength(2);
});
it('supervisor começa como membro e recebe apenas capacidades explícitas', async () => {
  expect(
    (
      await call('PUT', '/api/members/' + member + '/access', owner, {
        tenant_role: 'supervisor',
        mailbox_roles: [
          { mailbox_id: box, role: 'viewer', restrict_to_folders: true, folder_ids: [allowed] },
        ],
      })
    ).statusCode,
  ).toBe(200);
  expect((await call('GET', '/api/mailboxes', member)).json()).toHaveLength(1);
  expect((await call('GET', '/api/members', member)).statusCode).toBe(403);
  expect((await call('GET', '/api/dashboard/kpis', member)).statusCode).toBe(200);
  expect((await call('GET', '/api/superadmin/tenants', member)).statusCode).toBe(403);
  expect(
    (
      await call('PUT', '/api/members/' + member + '/access', owner, {
        tenant_role: 'supervisor',
        capabilities: ['dashboard', 'members', 'audit', 'rules'],
        mailbox_roles: [
          { mailbox_id: box, role: 'viewer', restrict_to_folders: true, folder_ids: [allowed] },
        ],
      })
    ).statusCode,
  ).toBe(200);
  expect((await call('GET', '/api/members', member)).statusCode).toBe(200);
  expect((await call('GET', '/api/audit-logs', member)).statusCode).toBe(200);
  const stale = await call('GET', '/api/dashboard/stale-threads', member);
  expect(stale.statusCode, stale.body).toBe(200);
  expect(stale.body).toContain('Assunto autorizado');
  expect(stale.body).not.toContain('Assunto secreto');
  expect((await call('PATCH', '/api/tenant', member, { name: 'Inválido' })).statusCode).toBe(403);
});
it('superadmin não herda acesso operacional de proprietário nem de suporte legado', async () => {
  expect((await call('GET', '/api/superadmin/tenants', owner)).statusCode).toBe(403);
  for (const path of ['tenants', 'users', 'mailboxes', 'audit', 'logs', 'health'])
    expect((await call('GET', '/api/superadmin/' + path, global)).statusCode).toBe(200);
  const session = await db
    .selectFrom('sessions')
    .select('token_hash')
    .where('user_id', '=', global)
    .executeTakeFirstOrThrow();
  const legacy = await db
    .insertInto('support_sessions')
    .values({
      user_id: global,
      session_hash: session.token_hash,
      tenant_id: tenant,
      reason: 'Suporte anterior à alteração',
      expires_at: new Date(Date.now() + 3600000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('tenant_members')
    .values({ tenant_id: tenant, user_id: global, role: 'owner' })
    .execute();
  await db
    .insertInto('mailbox_members')
    .values({ tenant_id: tenant, mailbox_id: box, user_id: global, role: 'mailbox_admin' })
    .execute();
  await db
    .updateTable('users')
    .set({ current_tenant_id: tenant })
    .where('id', '=', global)
    .execute();
  const me = (await call('GET', '/api/auth/me', global)).json();
  expect(me.platform_admin).toBe(true);
  expect(me.current_tenant_id).toBeNull();
  expect(me.support).toBeNull();
  expect(me.tenants).toEqual([]);
  expect(await userCanReadThread(db, tenant, box, global, thread)).toBe(false);
  expect(await userCanReadFolder(db, tenant, box, global, allowed)).toBe(false);
  await db.insertInto('platform_admins').values({ user_id: member }).execute();
  try {
    expect(
      (
        await call('PUT', '/api/superadmin/users/' + member + '/access', global, {
          tenant_id: tenant,
          tenant_role: 'owner',
          capabilities: [],
          mailbox_roles: [],
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call('POST', '/api/superadmin/tenants', global, {
          name: 'Não criar',
          slug: 'blocked-' + suffix,
          owner_email: member + '@apmail.local',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call('POST', '/api/superadmin/invitations', global, {
          tenant_id: tenant,
          email: member + '@apmail.local',
          tenant_role: 'member',
          capabilities: [],
          mailbox_roles: [],
        })
      ).statusCode,
    ).toBe(409);
  } finally {
    await db.deleteFrom('platform_admins').where('user_id', '=', member).execute();
  }
  for (const path of [
    '/api/mailboxes',
    '/api/threads/' + thread,
    '/api/dashboard/summary',
    '/api/contacts',
    '/api/chat/conversations',
    '/api/notifications',
    '/api/signatures',
  ]) {
    const blocked = await call('GET', path, global);
    expect(blocked.statusCode, path).toBe(403);
    expect(blocked.json().error.code).toBe('platform_only');
    expect(blocked.body).not.toContain('Assunto secreto');
  }
  for (const [method, path, body] of [
    ['POST', '/api/superadmin/support', { tenant_id: tenant, reason: 'Investigar solicitação QA' }],
    ['POST', '/api/outbox', { mailbox_id: box }],
    ['POST', '/api/tenants', { name: 'Não pode', slug: 'invalido-' + suffix }],
    ['PUT', '/api/me/current-tenant', { tenant_id: tenant }],
  ] as const)
    expect((await call(method, path, global, body)).statusCode).toBe(403);
  expect((await call('GET', '/api/preferences', global)).statusCode).toBe(200);
  expect((await call('GET', '/api/threads/' + thread, owner)).statusCode).toBe(200);
  expect((await call('DELETE', '/api/superadmin/support', global)).statusCode).toBe(200);
  expect(
    (
      await db
        .selectFrom('support_sessions')
        .select('ended_at')
        .where('id', '=', legacy.id)
        .executeTakeFirstOrThrow()
    ).ended_at,
  ).not.toBeNull();
});
it('suspensão remove o acesso HTTP e reativação preserva os dados', async () => {
  expect(
    (await call('PATCH', '/api/superadmin/tenants/' + tenant, global, { suspended: true }))
      .statusCode,
  ).toBe(200);
  expect((await call('GET', '/api/mailboxes', owner)).statusCode).toBe(409);
  expect(
    (await call('PATCH', '/api/superadmin/tenants/' + tenant, global, { suspended: false }))
      .statusCode,
  ).toBe(200);
  expect((await call('GET', '/api/contacts/' + contact, owner)).statusCode).toBe(200);
});
it('convites exigem caixa ativa e guardam IDs em vez de credenciais', async () => {
  await db
    .updateTable('mailboxes')
    .set({ status: 'disabled' })
    .where('tenant_id', '=', tenant)
    .execute();
  expect(
    (
      await call('POST', '/api/invitations', owner, {
        email: 'invite-' + suffix + '@apmail.local',
        tenant_role: 'member',
        mailbox_roles: [],
      })
    ).statusCode,
  ).toBe(409);
  await db.updateTable('mailboxes').set({ status: 'active' }).where('id', '=', box).execute();
  const invite = await call('POST', '/api/invitations', owner, {
    email: 'invite-' + suffix + '@apmail.local',
    tenant_role: 'supervisor',
    capabilities: ['rules'],
    sender_mailbox_id: box,
    mailbox_roles: [{ mailbox_id: box, role: 'editor' }],
  });
  expect(invite.statusCode, invite.body).toBe(201);
  const row = await db
    .selectFrom('invitations')
    .select(['sender_mailbox_id', 'sender_context', 'delivery_status', 'capabilities'])
    .where('id', '=', invite.json().id)
    .executeTakeFirstOrThrow();
  expect(row).toMatchObject({
    sender_mailbox_id: box,
    sender_context: 'tenant',
    delivery_status: 'pending',
    capabilities: ['rules'],
  });
});
it('upload de assinatura normaliza PNG e URL pública imutável, sem autenticação', async () => {
  const input = await sharp({
    create: { width: 20, height: 10, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 1 } },
  })
    .webp()
    .toBuffer();
  const boundary = 'apmail-' + suffix,
    payload = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="logo.webp"\r\nContent-Type: image/webp\r\n\r\n`,
      ),
      input,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
  const upload = await app.inject({
    method: 'POST',
    url: '/api/signatures/images',
    headers: {
      origin,
      cookie: cookies.get(owner)!,
      'content-type': 'multipart/form-data; boundary=' + boundary,
    },
    payload,
  });
  expect(upload.statusCode, upload.body).toBe(200);
  const path = new URL(upload.json().url).pathname,
    read = await app.inject({ url: path });
  expect(read.statusCode).toBe(200);
  expect(read.headers['content-type']).toContain('image/png');
  expect(read.headers['cache-control']).toContain('immutable');
  expect((await sharp(read.rawPayload).metadata()).width).toBe(20);
});
it('gestão global edita capacidades e caixas sem promover o próprio ator', async () => {
  expect(
    (await call('GET', '/api/superadmin/users/' + member + '/access?tenant_id=' + tenant, owner))
      .statusCode,
  ).toBe(403);
  const body = {
    tenant_id: tenant,
    tenant_role: 'supervisor',
    capabilities: ['rules'],
    mailbox_roles: [
      { mailbox_id: box, role: 'viewer', restrict_to_folders: true, folder_ids: [allowed] },
    ],
  };
  expect(
    (await call('PUT', '/api/superadmin/users/' + member + '/access', global, body)).statusCode,
  ).toBe(200);
  const access = await call(
    'GET',
    '/api/superadmin/users/' + member + '/access?tenant_id=' + tenant,
    global,
  );
  expect(access.json()).toMatchObject({ tenant_role: 'supervisor', capabilities: ['rules'] });
  expect(access.json().mailbox_roles[0].folder_ids).toContain(allowed);
  expect(
    (await call('PUT', '/api/superadmin/users/' + global + '/access', global, body)).statusCode,
  ).toBe(403);
  const rule = {
    mailbox_id: box,
    scope: 'mailbox',
    name: 'Destino restrito',
    is_active: true,
    priority: 100,
    match_mode: 'all',
    stop_processing: false,
    conditions: [{ field: 'subject', operator: 'equals', value: 'QA' }],
    actions: [{ type: 'move_to_folder', folder_id: hidden }],
  };
  expect((await call('POST', '/api/rules', member, rule)).statusCode).toBe(404);
});
it('consulta CNPJ usa fonte alternativa e valida CEP sem impedir preenchimento manual', async () => {
  const cnpj = '12345678000195',
    cache = new Redis(redisUrl);
  await cache.del('lookup:cnpj:' + cnpj);
  const fetch = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(new Response('indisponível', { status: 403 }))
    .mockResolvedValueOnce(
      Response.json({
        razao_social: 'Empresa de consulta QA',
        nome_fantasia: 'QA',
        cep: '01001000',
        municipio: 'São Paulo',
        uf: 'SP',
      }),
    );
  try {
    const result = await call('GET', '/api/contacts/lookup/cnpj/' + cnpj, owner);
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({
      source: 'Minha Receita',
      company: { name: 'Empresa de consulta QA', cnpj },
      address: { city: 'São Paulo' },
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect((await call('GET', '/api/contacts/lookup/cep/123', owner)).statusCode).toBe(400);
  } finally {
    fetch.mockRestore();
    await cache.del('lookup:cnpj:' + cnpj);
    await cache.quit();
  }
});
