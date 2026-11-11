import { beforeAll, afterAll, expect, it } from 'vitest';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pino from 'pino';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import {
  createDb,
  createQueues,
  ensureLocalFolders,
  migrate,
  Storage,
  asJson,
  registerSecurityFile,
  postWebhook,
  webhookUrl,
} from '@apmail/db';
import { buildApp } from '../../../api/src/app.js';
import { envSchema } from '../../../api/src/env.js';
import { envSchema as workerEnv } from '../../src/env.js';
import {
  handleIntegrationWebhook,
  sweepIntegrationWebhooks,
} from '../../src/handlers/integration-webhooks.js';
import { ingestMessage } from '../../src/imap/ingest-message.js';
import { hashToken } from '../../../api/src/plugins/auth.js';

const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (
  !url ||
  !new URL(url).pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
)
  throw Error('Isolated local test DB required');
if (!redisUrl || !['localhost', '127.0.0.1'].includes(new URL(redisUrl).hostname))
  throw Error('Isolated local Redis required');
const db = createDb(url),
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null }),
  queues = createQueues(redisUrl);
const tenant = randomUUID(),
  foreign = randomUUID(),
  origin = 'http://localhost:5173',
  root = join(tmpdir(), 'apmail-integrations-' + tenant),
  key = randomBytes(32).toString('base64');
const config = {
  NODE_ENV: 'test',
  DATABASE_URL: url,
  REDIS_URL: redisUrl,
  APP_URL: origin,
  STORAGE_DIR: root,
  SESSION_SECRET: key,
  CREDENTIALS_ENCRYPTION_KEY: key,
  LOG_LEVEL: 'silent',
};
const app = await buildApp(envSchema.parse(config));
const storage = new Storage(root, db);
const r = {
  db,
  redis,
  queues: queues.queues,
  storage,
  log: pino({ level: 'silent' }),
  io: new Emitter(redis),
  env: workerEnv.parse(config),
};
type User = { id: string; email: string; cookie: string };
let owner: User, otherOwner: User;
async function user(tid = tenant, role: 'owner' | 'member' = 'member'): Promise<User> {
  const id = randomUUID(),
    email = id + '@integration.test',
    secret = randomBytes(32).toString('base64url');
  await db
    .insertInto('users')
    .values({ id, email, full_name: 'Pessoa QA', password_hash: 'fixture', current_tenant_id: tid })
    .execute();
  await db.insertInto('tenant_members').values({ tenant_id: tid, user_id: id, role }).execute();
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
async function box(member?: User, tid = tenant) {
  const id = randomUUID();
  await db
    .insertInto('mailboxes')
    .values({
      id,
      tenant_id: tid,
      name: 'Caixa integração QA',
      email_address: id + '@integration.test',
      username: 'qa',
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
      user_id: (tid === tenant ? owner : otherOwner).id,
      role: 'mailbox_admin',
    })
    .execute();
  if (member)
    await db
      .insertInto('mailbox_members')
      .values({ tenant_id: tid, mailbox_id: id, user_id: member.id, role: 'editor' })
      .execute();
  const folders = await db.selectFrom('folders').selectAll().where('mailbox_id', '=', id).execute();
  return {
    id,
    tenant: tid,
    inbox: folders.find((f) => f.special_use === 'inbox')!,
    sent: folders.find((f) => f.special_use === 'sent')!,
  };
}
async function message(
  b: Awaited<ReturnType<typeof box>>,
  opts: {
    historical?: boolean;
    outbound?: boolean;
    header?: string;
    assigned?: string;
    html?: string;
  } = {},
) {
  const id = randomUUID(),
    thread = randomUUID();
  await db
    .insertInto('threads')
    .values({
      id: thread,
      tenant_id: b.tenant,
      mailbox_id: b.id,
      subject: 'Assunto QA',
      assigned_to: opts.assigned ?? null,
    })
    .execute();
  await db
    .insertInto('messages')
    .values({
      id,
      tenant_id: b.tenant,
      mailbox_id: b.id,
      thread_id: thread,
      folder_id: opts.outbound ? b.sent.id : b.inbox.id,
      message_id_header: opts.header ?? `<${id}@integration.test>`,
      message_at: new Date(),
      from_address: 'cliente@integration.test',
      from_name: 'Cliente',
      to_addresses: asJson([{ name: 'Equipe', address: 'equipe@integration.test' }]),
      subject: 'Olá integração',
      body_text: 'Texto com assinatura',
      body_html: '<p>Olá<img src="cid:logo"></p>',
      body_html_original: opts.html ?? '<p style="color:red">Olá<img src="cid:logo"></p>',
      direction: opts.outbound ? 'outbound' : 'inbound',
      source_kind: 'imap',
      is_historical: opts.historical ?? false,
      references_headers: ['<anterior@integration.test>'],
    })
    .execute();
  return { id, thread };
}
function admin(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string,
  payload?: unknown,
  who = owner,
) {
  return app.inject({
    method,
    url: '/api/integrations' + path,
    headers: {
      cookie: who.cookie,
      origin,
      ...(payload === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined ? {} : { payload: JSON.stringify(payload) }),
  });
}
async function token(
  u: User,
  boxes: string[],
  permissions = ['messages:read', 'attachments:download'],
) {
  const made = await admin('POST', '/api-tokens', { name: 'Sistema QA', expires_in_days: null });
  expect(made.statusCode, made.body).toBe(201);
  const t = made.json<{ id: string; token: string }>();
  const saved = await admin('PUT', `/api-tokens/${t.id}/access`, {
    user_ids: [u.id],
    mailbox_ids: boxes,
    permissions,
  });
  expect(saved.statusCode, saved.body).toBe(200);
  return t;
}
function get(secret: string, u: User, path: string) {
  return app.inject({
    method: 'GET',
    url:
      '/api/integrations' +
      path +
      (path.includes('?') ? '&' : '?') +
      'email=' +
      encodeURIComponent(u.email),
    headers: { authorization: 'Bearer ' + secret },
  });
}
async function webhook(b: Awaited<ReturnType<typeof box>>, enabled = true) {
  const response = await admin('POST', '/webhooks', {
    name: 'Eventos QA',
    url: 'https://example.com/apmail',
    enabled,
    event: 'email.received',
    mailbox_ids: [b.id],
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ id: string; secret: string }>();
}
async function delivery(id: string) {
  return db
    .selectFrom('integration_webhook_deliveries')
    .selectAll()
    .where('webhook_id', '=', id)
    .orderBy('created_at', 'desc')
    .executeTakeFirstOrThrow();
}
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Integrações QA', slug: tenant },
      { id: foreign, name: 'Outra empresa QA', slug: foreign },
    ])
    .execute();
  owner = await user(tenant, 'owner');
  otherOwner = await user(foreign, 'owner');
}, 30000);
afterAll(async () => {
  await app.close();
  await queues.close();
  await redis.quit();
  await db.destroy();
});

it('mantém tokens antigos somente nas notificações e exige usuário e caixa para conteúdo', async () => {
  const u = await user(),
    b = await box(u),
    m = await message(b),
    t = await token(u, [], ['notifications:read']);
  expect((await get(t.token, u, `/messages?messageId=${m.id}`)).statusCode).toBe(403);
  expect((await get(t.token, u, '/notifications')).statusCode).toBe(200);
  expect(
    (
      await admin('PUT', `/api-tokens/${t.id}/access`, {
        permissions: ['messages:read'],
        user_ids: [u.id],
      })
    ).statusCode,
  ).toBe(400);
  const catalog = (await admin('GET', '/api-tokens')).json();
  expect(catalog.routes.map((route: { permission: string }) => route.permission)).toEqual(
    expect.arrayContaining(['notifications:read', 'messages:read', 'attachments:download']),
  );
});
it('entrega HTML original, assinatura, endereços e CID sem marcar a conversa como lida', async () => {
  const u = await user(),
    b = await box(u),
    m = await message(b),
    t = await token(u, [b.id]);
  const response = await get(t.token, u, `/messages?messageId=${m.id}`);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().data).toMatchObject({
    id: m.id,
    subject: 'Olá integração',
    isRead: false,
    body: {
      originalAvailable: true,
      text: 'Texto com assinatura',
      html: expect.stringContaining('cid:logo'),
    },
    to: [{ name: 'Equipe', email: 'equipe@integration.test' }],
    references: ['<anterior@integration.test>'],
  });
  expect(
    await db
      .selectFrom('thread_user_state')
      .selectAll()
      .where('thread_id', '=', m.thread)
      .where('user_id', '=', u.id)
      .execute(),
  ).toEqual([]);
  await db
    .insertInto('thread_user_state')
    .values({
      tenant_id: tenant,
      thread_id: m.thread,
      user_id: u.id,
      last_read_at: new Date(Date.now() + 1000),
    })
    .execute();
  expect((await get(t.token, u, `/messages?messageId=${m.id}`)).json().data.isRead).toBe(true);
  await db
    .updateTable('messages')
    .set({ body_html_original: null })
    .where('id', '=', m.id)
    .execute();
  expect((await get(t.token, u, `/messages?messageId=${m.id}`)).json().data.body).toMatchObject({
    originalAvailable: false,
    html: '<p>Olá<img src="cid:logo"></p>',
  });
});
it('bloqueia outra empresa, usuário fora do escopo, caixa não concedida e administrador sem vínculo', async () => {
  const u = await user(),
    outsider = await user(),
    b = await box(u),
    hidden = await box(),
    foreignBox = await box(undefined, foreign),
    m = await message(b),
    h = await message(hidden),
    f = await message(foreignBox),
    t = await token(u, [b.id]);
  expect((await get(t.token, u, `/messages?messageId=${h.id}`)).statusCode).toBe(404);
  expect((await get(t.token, u, `/messages?messageId=${f.id}`)).statusCode).toBe(404);
  expect((await get(t.token, outsider, `/messages?messageId=${m.id}`)).statusCode).toBe(404);
  await db
    .updateTable('tenant_members')
    .set({ role: 'admin' })
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', u.id)
    .execute();
  await db
    .deleteFrom('mailbox_members')
    .where('mailbox_id', '=', b.id)
    .where('user_id', '=', u.id)
    .execute();
  expect((await get(t.token, u, `/messages?messageId=${m.id}`)).statusCode).toBe(404);
  expect(
    (
      await admin('PUT', `/api-tokens/${t.id}/access`, {
        permissions: ['messages:read'],
        user_ids: [u.id],
        mailbox_ids: [foreignBox.id],
      })
    ).statusCode,
  ).toBe(404);
});
it('aplica restrição de operador, convite pontual e encerramento sem reativação na reabertura', async () => {
  const u = await user(),
    b = await box(u),
    mine = await message(b, { assigned: u.id }),
    other = await message(b),
    privateBox = await box(),
    invited = await message(privateBox),
    privateOther = await message(privateBox),
    t = await token(u, [b.id, privateBox.id]);
  await db
    .updateTable('tenants')
    .set({ settings: asJson({ restrict_operators_to_assigned: true }) })
    .where('id', '=', tenant)
    .execute();
  expect((await get(t.token, u, `/messages?messageId=${mine.id}`)).statusCode).toBe(200);
  expect((await get(t.token, u, `/messages?messageId=${other.id}`)).statusCode).toBe(404);
  const invite = await app.inject({
    method: 'POST',
    url: `/api/threads/${invited.thread}/invitations`,
    headers: { origin, cookie: owner.cookie, 'content-type': 'application/json' },
    payload: { user_id: u.id },
  });
  expect(invite.statusCode, invite.body).toBe(201);
  expect((await get(t.token, u, `/messages?messageId=${invited.id}`)).statusCode).toBe(200);
  expect((await get(t.token, u, `/messages?messageId=${privateOther.id}`)).statusCode).toBe(404);
  await db
    .updateTable('threads')
    .set({ manual_done_at: new Date(), queue_status: 'done' })
    .where('id', '=', invited.thread)
    .execute();
  expect((await get(t.token, u, `/messages?messageId=${invited.id}`)).statusCode).toBe(404);
  await db
    .updateTable('thread_service_invitations')
    .set({ state: 'completed' })
    .where('thread_id', '=', invited.thread)
    .execute();
  await db
    .updateTable('threads')
    .set({ manual_done_at: null, queue_status: 'to_reply' })
    .where('id', '=', invited.thread)
    .execute();
  expect((await get(t.token, u, `/messages?messageId=${invited.id}`)).statusCode).toBe(404);
  await db
    .updateTable('tenants')
    .set({ settings: asJson({}) })
    .where('id', '=', tenant)
    .execute();
});
it('aplica pastas autorizadas inclusive no GET direto', async () => {
  const u = await user(),
    b = await box(u),
    m = await message(b),
    t = await token(u, [b.id]);
  await db
    .updateTable('mailbox_members')
    .set({ restrict_to_folders: true })
    .where('mailbox_id', '=', b.id)
    .where('user_id', '=', u.id)
    .execute();
  expect((await get(t.token, u, `/messages?messageId=${m.id}`)).statusCode).toBe(404);
  await db
    .insertInto('folder_permissions')
    .values({ tenant_id: tenant, mailbox_id: b.id, folder_id: b.inbox.id, user_id: u.id })
    .execute();
  expect((await get(t.token, u, `/messages?messageId=${m.id}`)).statusCode).toBe(200);
});
it('pagina por cursor durável, inclui históricos sem corpo e recupera inserções posteriores', async () => {
  const u = await user(),
    b = await box(u),
    a = await message(b, { historical: true }),
    bmsg = await message(b),
    t = await token(u, [b.id]);
  const first = await get(t.token, u, '/messages?limit=1');
  expect(first.statusCode, first.body).toBe(200);
  expect(first.json().data).toMatchObject({
    hasMore: true,
    items: [{ id: a.id, body: null, bodyIncluded: false }],
  });
  const second = await get(t.token, u, '/messages?limit=1&cursor=' + first.json().data.nextCursor);
  expect(second.json().data).toMatchObject({ hasMore: false, items: [{ id: bmsg.id }] });
  const next = second.json().data.nextCursor,
    c = await message(b);
  expect(
    (await get(t.token, u, '/messages?cursor=' + next))
      .json()
      .data.items.map((m: { id: string }) => m.id),
  ).toEqual([c.id]);
  expect(
    (await get(t.token, u, '/messages?mailboxId=' + b.id + '&cursor=' + next)).statusCode,
  ).toBe(400);
});
it('não perde eventos de transações concorrentes com commits em andamento', async () => {
  const u = await user(),
    b = await box(u),
    t = await token(u, [b.id]),
    empty = (await get(t.token, u, '/messages')).json().data.nextCursor;
  let release!: () => void, inserted!: () => void;
  const gate = new Promise<void>((resolve) => {
      release = resolve;
    }),
    ready = new Promise<void>((resolve) => {
      inserted = resolve;
    });
  const thread = randomUUID(),
    id = randomUUID();
  await db
    .insertInto('threads')
    .values({ id: thread, tenant_id: tenant, mailbox_id: b.id, subject: 'Concorrência' })
    .execute();
  const pending = db.transaction().execute(async (tx) => {
    await tx
      .insertInto('messages')
      .values({
        id,
        tenant_id: tenant,
        mailbox_id: b.id,
        thread_id: thread,
        folder_id: b.inbox.id,
        message_id_header: `<${id}@test>`,
        from_address: 'qa@test',
        subject: 'QA',
        message_at: new Date(),
        direction: 'inbound',
      })
      .execute();
    inserted();
    await gate;
  });
  await ready;
  try {
    const poll = await get(t.token, u, '/messages?cursor=' + empty);
    expect(poll.json().data.items).toEqual([]);
    const cursor = poll.json().data.nextCursor;
    release();
    await pending;
    expect(
      (await get(t.token, u, '/messages?cursor=' + cursor))
        .json()
        .data.items.map((m: { id: string }) => m.id),
    ).toEqual([id]);
  } finally {
    release();
    await pending;
  }
});
it('separa download de conteúdo, bloqueia anexo pendente/infectado e transmite bytes após análise', async () => {
  const u = await user(),
    b = await box(u),
    m = await message(b),
    t = await token(u, [b.id], ['messages:read']),
    id = randomUUID(),
    path = `attachments/${tenant}/${b.id}/${m.id}/${id}`,
    bytes = Buffer.from('arquivo QA');
  await storage.writeFile(path, bytes);
  await db
    .insertInto('attachments')
    .values({
      id,
      tenant_id: tenant,
      mailbox_id: b.id,
      message_id: m.id,
      filename: 'relatório.txt',
      content_type: 'text/plain',
      size_bytes: bytes.length,
      storage_path: path,
      is_inline: true,
      content_id: 'logo',
    })
    .execute();
  await registerSecurityFile(db, {
    storage_key: path,
    tenant_id: tenant,
    mailbox_id: b.id,
    message_id: m.id,
    filename: 'relatório.txt',
    content_type: 'text/plain',
    size_bytes: bytes.length,
    kind: 'attachment',
  });
  const route = `/messages/${m.id}/attachments/${id}`;
  expect((await get(t.token, u, route)).statusCode).toBe(403);
  const granted = await admin('PUT', `/api-tokens/${t.id}/access`, {
    permissions: ['attachments:download'],
    user_ids: [u.id],
    mailbox_ids: [b.id],
  });
  expect(granted.statusCode).toBe(200);
  expect((await get(t.token, u, `/messages?messageId=${m.id}`)).statusCode).toBe(403);
  expect((await get(t.token, u, route)).statusCode).toBe(409);
  await db
    .updateTable('file_security')
    .set({ status: 'infected', threat_name: 'QA.Test' })
    .where('storage_key', '=', path)
    .execute();
  expect((await get(t.token, u, route)).statusCode).toBe(403);
  await db
    .updateTable('file_security')
    .set({
      status: 'clean',
      sha256: createHash('sha256').update(bytes).digest('hex'),
      scanned_at: new Date(),
      threat_name: null,
    })
    .where('storage_key', '=', path)
    .execute();
  const download = await get(t.token, u, route);
  expect(download.statusCode, download.body).toBe(200);
  expect(download.rawPayload).toEqual(bytes);
  expect(download.headers['content-disposition']).toContain('filename*=UTF-8');
});

it('webhooks são independentes de token, escopados por tenant e segredo é exibido só uma vez', async () => {
  const b = await box(),
    w = await webhook(b),
    list = await admin('GET', '/webhooks');
  expect(list.statusCode).toBe(200);
  expect(list.body).not.toContain(w.secret);
  expect(list.body).not.toContain('encrypted_secret');
  expect(
    (await admin('GET', `/webhooks/${w.id}/deliveries`, undefined, otherOwner)).statusCode,
  ).toBe(404);
  const u = await user();
  expect((await admin('GET', '/webhooks', undefined, u)).statusCode).toBe(403);
  const foreignBox = await box(undefined, foreign);
  expect(
    (
      await admin('POST', '/webhooks', {
        name: 'QA',
        url: 'https://example.com',
        event: 'email.received',
        mailbox_ids: [foreignBox.id],
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await db
        .selectFrom('integration_api_tokens')
        .select('id')
        .where('tenant_id', '=', tenant)
        .execute()
    ).length,
  ).toBeGreaterThan(0);
});
it('evento é atômico e único por identidade/caixa; importações e enviados não disparam webhook', async () => {
  const b = await box(),
    w = await webhook(b),
    header = `<${randomUUID()}@test>`;
  const m = await message(b, { header });
  await message(b, { header });
  await message(b, { historical: true });
  await message(b, { outbound: true });
  const deliveries = await db
    .selectFrom('integration_webhook_deliveries')
    .selectAll()
    .where('webhook_id', '=', w.id)
    .execute();
  expect(deliveries).toHaveLength(1);
  expect(deliveries[0]!.event_id).toBeTruthy();
  const event = await db
    .selectFrom('integration_message_events')
    .select('message_id')
    .where('id', '=', deliveries[0]!.event_id!)
    .executeTakeFirstOrThrow();
  expect(event.message_id).toBe(m.id);
});
it('assina bytes originais, registra falha/reenvio e mantém eventId estável', async () => {
  const b = await box(),
    w = await webhook(b),
    m = await message(b),
    d = await delivery(w.id),
    calls: { body: string; headers: Record<string, string> }[] = [];
  const sender = async (_url: string, body: string, headers: Record<string, string>) => {
    calls.push({ body, headers });
    return calls.length === 1 ? 503 : 204;
  };
  await handleIntegrationWebhook(r, d.id, sender);
  let saved = await delivery(w.id);
  expect(saved).toMatchObject({ state: 'retry', attempts: 1, last_status: 503 });
  await db
    .updateTable('integration_webhook_deliveries')
    .set({ next_attempt_at: new Date(0) })
    .where('id', '=', d.id)
    .execute();
  await handleIntegrationWebhook(r, d.id, sender);
  saved = await delivery(w.id);
  expect(saved).toMatchObject({ state: 'delivered', attempts: 2 });
  expect(calls).toHaveLength(2);
  for (const call of calls) {
    const stamp = call.headers['X-APMail-Timestamp']!;
    expect(call.headers['X-APMail-Signature']).toBe(
      'sha256=' +
        createHmac('sha256', w.secret)
          .update(stamp + '.' + call.body)
          .digest('hex'),
    );
    expect(JSON.parse(call.body)).toMatchObject({
      event: 'email.received',
      eventId: d.event_key,
      test: false,
      data: { id: m.id, isRead: null },
    });
  }
  expect(
    await db
      .selectFrom('integration_webhook_attempts')
      .select('http_status')
      .where('delivery_id', '=', d.id)
      .orderBy('number')
      .execute(),
  ).toEqual([{ http_status: 503 }, { http_status: 204 }]);
});
it('encerra após cinco falhas e permite reenvio administrativo preservando o evento', async () => {
  const b = await box(),
    w = await webhook(b);
  await message(b);
  const d = await delivery(w.id);
  for (let number = 1; number <= 5; number++) {
    await db
      .updateTable('integration_webhook_deliveries')
      .set({ next_attempt_at: new Date(0) })
      .where('id', '=', d.id)
      .execute();
    await handleIntegrationWebhook(r, d.id, async () => 503);
    expect((await delivery(w.id)).attempts).toBe(number);
  }
  expect((await delivery(w.id)).state).toBe('failed');
  expect((await admin('POST', `/webhooks/${w.id}/deliveries/${d.id}/retry`, {})).statusCode).toBe(
    200,
  );
  await db
    .updateTable('integration_webhook_deliveries')
    .set({ next_attempt_at: new Date(0) })
    .where('id', '=', d.id)
    .execute();
  await handleIntegrationWebhook(r, d.id, async (_url, body) => {
    expect(JSON.parse(body).eventId).toBe(d.event_key);
    return 204;
  });
  expect(await delivery(w.id)).toMatchObject({ state: 'delivered', attempts: 6, max_attempts: 10 });
});

it('não exporta conteúdo de tenant suspenso nem mensagem já retida', async () => {
  const b = await box(),
    w = await webhook(b),
    m = await message(b),
    d = await delivery(w.id);
  await db
    .updateTable('tenants')
    .set({ suspended_at: new Date() })
    .where('id', '=', tenant)
    .execute();
  let calls = 0;
  try {
    await handleIntegrationWebhook(r, d.id, async () => {
      calls++;
      return 200;
    });
    expect(calls).toBe(0);
    expect((await delivery(w.id)).state).toBe('cancelled');
  } finally {
    await db.updateTable('tenants').set({ suspended_at: null }).where('id', '=', tenant).execute();
  }
  const next = await message(b),
    pending = await delivery(w.id);
  await db
    .updateTable('messages')
    .set({ deleted_at: new Date() })
    .where('id', '=', next.id)
    .execute();
  await handleIntegrationWebhook(r, pending.id, async () => {
    calls++;
    return 200;
  });
  expect(calls).toBe(0);
  expect((await delivery(w.id)).state).toBe('cancelled');
  expect(
    await db.selectFrom('messages').select('id').where('id', '=', m.id).executeTakeFirst(),
  ).toBeTruthy();
});

it('recupera lease expirado e agenda entrega persistida mesmo após perda do job', async () => {
  const b = await box(),
    w = await webhook(b);
  await message(b);
  const d = await delivery(w.id);
  await db
    .updateTable('integration_webhook_deliveries')
    .set({
      state: 'delivering',
      attempts: 1,
      lease_token: randomUUID(),
      lease_expires_at: new Date(0),
    })
    .where('id', '=', d.id)
    .execute();
  await db
    .insertInto('integration_webhook_attempts')
    .values({ delivery_id: d.id, number: 1 })
    .execute();
  await sweepIntegrationWebhooks(r);
  expect((await delivery(w.id)).state).toBe('retry');
  expect(await queues.queues['integration-webhooks'].getJob(d.id)).toBeTruthy();
  await handleIntegrationWebhook(r, d.id, async () => 200);
  expect((await delivery(w.id)).state).toBe('delivered');
});
it('cancela pendências ao desativar/editar e permite teste sem e-mail e sem chave de API', async () => {
  const b = await box(),
    w = await webhook(b);
  await message(b);
  const d = await delivery(w.id);
  const edit = await admin('PUT', `/webhooks/${w.id}`, {
    name: 'Novo nome',
    url: 'https://example.com/new',
    enabled: false,
    event: 'email.received',
    mailbox_ids: [b.id],
  });
  expect(edit.statusCode, edit.body).toBe(200);
  expect((await delivery(w.id)).state).toBe('cancelled');
  let calls = 0;
  await handleIntegrationWebhook(r, d.id, async () => {
    calls++;
    return 200;
  });
  expect(calls).toBe(0);
  const test = await admin('POST', `/webhooks/${w.id}/test`, {});
  expect(test.statusCode).toBe(202);
  await handleIntegrationWebhook(r, test.json().deliveryId, async (_url, body) => {
    expect(JSON.parse(body)).toMatchObject({ test: true, data: null });
    return 200;
  });
  expect(
    (
      await db
        .selectFrom('integration_webhook_deliveries')
        .select('state')
        .where('id', '=', test.json().deliveryId)
        .executeTakeFirstOrThrow()
    ).state,
  ).toBe('delivered');
});
it('rotaciona segredo, registra histórico e exclui webhook com relações sem excluir mensagens', async () => {
  const b = await box(),
    w = await webhook(b),
    m = await message(b),
    rotated = await admin('POST', `/webhooks/${w.id}/secret`, {});
  expect(rotated.statusCode).toBe(200);
  expect(rotated.json().secret).not.toBe(w.secret);
  const history = await admin('GET', `/webhooks/${w.id}/deliveries`);
  expect(history.statusCode).toBe(200);
  expect(history.json().total).toBe(1);
  expect((await admin('DELETE', `/webhooks/${w.id}`)).statusCode).toBe(200);
  expect(
    await db
      .selectFrom('integration_webhook_deliveries')
      .select('id')
      .where('webhook_id', '=', w.id)
      .execute(),
  ).toEqual([]);
  expect(
    await db.selectFrom('messages').select('id').where('id', '=', m.id).executeTakeFirst(),
  ).toBeTruthy();
});
it('omite corpo volumoso no webhook e mantém GET completo disponível', async () => {
  const u = await user(),
    b = await box(u),
    w = await webhook(b),
    html = '<p>' + 'x'.repeat(2 * 1024 * 1024) + '</p>',
    m = await message(b, { html }),
    d = await delivery(w.id),
    t = await token(u, [b.id]);
  await handleIntegrationWebhook(r, d.id, async (_url, body) => {
    expect(Buffer.byteLength(body)).toBeLessThan(2 * 1024 * 1024);
    expect(JSON.parse(body).data).toMatchObject({ id: m.id, body: null, bodyIncluded: false });
    return 200;
  });
  expect((await get(t.token, u, `/messages?messageId=${m.id}`)).json().data.body.html).toBe(html);
});
it('ingestão IMAP preserva HTML original e publica um evento sem depender do Redis', async () => {
  const b = await box(),
    w = await webhook(b),
    stored = await db
      .selectFrom('mailboxes')
      .selectAll()
      .where('id', '=', b.id)
      .executeTakeFirstOrThrow(),
    id = randomUUID();
  const source = Buffer.from(
    `From: Cliente <cliente@integration.test>\r\nTo: ${stored.email_address}\r\nSubject: Novo email\r\nMessage-ID: <${id}@integration.test>\r\nDate: Wed, 11 Nov 2026 12:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p style="font-size:11pt">Assinatura original</p>`,
  );
  await ingestMessage(r, stored, b.inbox, {
    uid: 1,
    seq: 1,
    source,
    flags: new Set(),
    envelope: {},
  } as Parameters<typeof ingestMessage>[3]);
  const d = await delivery(w.id);
  expect(d.event_id).toBeTruthy();
  const msg = await db
    .selectFrom('messages')
    .select('body_html_original')
    .where('mailbox_id', '=', b.id)
    .executeTakeFirstOrThrow();
  expect(msg.body_html_original).toContain('font-size:11pt');
});
it('bloqueia SSRF em destinos privados, formatos alternativos e HTTP; não segue redirecionamentos', async () => {
  for (const target of [
    'http://example.com',
    'https://127.0.0.1',
    'https://2130706433',
    'https://[::1]',
    'https://10.1.1.1',
    'https://host.local',
    'https://user:pass@example.com',
    'https://example.com:8443',
    'https://example.com/#secret',
  ])
    expect(() => webhookUrl(target)).toThrow();
  await expect(postWebhook('https://127.0.0.1', '{}', {})).rejects.toThrow('destination_blocked');
  const b = await box(),
    w = await webhook(b);
  await message(b);
  const d = await delivery(w.id);
  await handleIntegrationWebhook(r, d.id, async () => 302);
  expect(await delivery(w.id)).toMatchObject({ state: 'retry', last_status: 302 });
});
