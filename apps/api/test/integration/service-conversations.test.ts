import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createDb,
  migrate,
  ensureLocalFolders,
  touchThreads,
  asJson,
  invitationAllowsPermission,
} from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';

const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Banco TEST obrigatório');
const db = createDb(url),
  tenant = randomUUID(),
  foreignTenant = randomUUID();
const owner = randomUUID(),
  operator = randomUUID(),
  supervisor = randomUUID(),
  guest = randomUUID(),
  viewer = randomUUID(),
  foreign = randomUUID();
const shared = randomUUID(),
  privateBox = randomUUID(),
  ownThread = randomUUID(),
  otherThread = randomUUID(),
  privateThread = randomUUID(),
  secretThread = randomUUID();
const privateMessage = randomUUID(),
  secretAttachment = randomUUID(),
  privateAttachment = randomUUID();
const cookies = new Map<string, string>(),
  origin = 'http://localhost:5173';
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: process.env.REDIS_URL_TEST,
    APP_URL: origin,
    STORAGE_DIR: join(tmpdir(), 'apmail-service-' + tenant),
    SESSION_SECRET: randomBytes(32).toString('base64'),
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  }),
);
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  who = owner,
  payload?: unknown,
) =>
  app.inject({
    method,
    url: '/api' + path,
    headers: {
      origin,
      cookie: cookies.get(who)!,
      ...(payload !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload !== undefined ? { payload: JSON.stringify(payload) } : {}),
  });
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Atendimento QA', slug: 'service-' + tenant },
      { id: foreignTenant, name: 'Externa QA', slug: 'service-' + foreignTenant },
    ])
    .execute();
  for (const id of [owner, operator, supervisor, guest, viewer, foreign]) {
    const tid = id === foreign ? foreignTenant : tenant;
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@service.test',
        full_name: id === owner ? 'Dono QA' : id === guest ? 'Convidado QA' : 'Pessoa ' + id,
        password_hash: 'fixture',
        current_tenant_id: tid,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tid, user_id: id, role: id === owner ? 'owner' : 'member' })
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
  for (const id of [shared, privateBox]) {
    await db
      .insertInto('mailboxes')
      .values({
        id,
        tenant_id: tenant,
        name: id === shared ? 'Compartilhada' : 'Individual privada',
        email_address: id + '@service.test',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        username: 'qa',
        receiving_protocol: 'pop3',
        status: 'active',
        queues_enabled: id === shared,
      })
      .execute();
    await ensureLocalFolders(db, tenant, id);
    await db
      .insertInto('mailbox_members')
      .values({ tenant_id: tenant, mailbox_id: id, user_id: owner, role: 'mailbox_admin' })
      .execute();
  }
  await db
    .insertInto('mailbox_members')
    .values([
      { tenant_id: tenant, mailbox_id: shared, user_id: operator, role: 'editor' },
      { tenant_id: tenant, mailbox_id: shared, user_id: supervisor, role: 'supervisor' },
      { tenant_id: tenant, mailbox_id: shared, user_id: viewer, role: 'viewer' },
    ])
    .execute();
  await db
    .updateTable('mailboxes')
    .set({ box_type: 'individual', owner_user_id: owner })
    .where('id', '=', privateBox)
    .execute();
  for (const [id, box, assigned, subject] of [
    [ownThread, shared, operator, 'Operador próprio'],
    [otherThread, shared, owner, 'Sigilo de outro responsável'],
    [privateThread, privateBox, owner, 'Conversa privada convidada'],
    [secretThread, privateBox, owner, 'Outro segredo privado'],
  ] as const) {
    const folder = await db
      .selectFrom('folders')
      .select('id')
      .where('mailbox_id', '=', box)
      .where('special_use', '=', 'inbox')
      .executeTakeFirstOrThrow();
    await db
      .insertInto('threads')
      .values({
        id,
        tenant_id: tenant,
        mailbox_id: box,
        subject,
        assigned_to: assigned,
        assigned_at: new Date(),
        history_queue_eligible: true,
      })
      .execute();
    await db
      .insertInto('messages')
      .values({
        id: id === privateThread ? privateMessage : randomUUID(),
        tenant_id: tenant,
        mailbox_id: box,
        thread_id: id,
        folder_id: folder.id,
        message_id_header: '<' + id + '@service.test>',
        message_at: new Date(),
        subject,
        body_text: subject,
        snippet: subject,
        from_address: 'cliente@service.test',
        to_addresses: asJson([{ address: box + '@service.test', name: '' }]),
        source_kind: 'archive',
        direction: 'inbound',
      })
      .execute();
    await touchThreads(db, [id], 'sync', null);
  }
  const secretMessage = await db
    .selectFrom('messages')
    .select('id')
    .where('thread_id', '=', secretThread)
    .executeTakeFirstOrThrow();
  for (const [id, message] of [
    [privateAttachment, privateMessage],
    [secretAttachment, secretMessage.id],
  ])
    await db
      .insertInto('attachments')
      .values({
        id,
        tenant_id: tenant,
        mailbox_id: privateBox,
        message_id: message!,
        filename: 'qa.pdf',
        content_type: 'application/pdf',
        size_bytes: 1,
        storage_path: 'qa-never-opened-' + id,
      })
      .execute();
}, 30000);
afterAll(async () => {
  await app.close();
  await db.destroy();
});

it('atribuição não inicia; leitura não inicia; início explícito funciona sem filas', async () => {
  const edited = await call('PATCH', '/mailboxes/' + privateBox, owner, { owner_user_id: owner });
  expect(edited.statusCode, edited.body).toBe(200);
  expect(edited.json()).toMatchObject({
    box_type: 'individual',
    queues_enabled: false,
    owner_user_id: owner,
  });
  const initial = await call('GET', '/threads/' + privateThread);
  expect(initial.statusCode, initial.body).toBe(200);
  expect(initial.json().thread.queue_status).toBe('to_reply');
  expect((await call('POST', '/threads/' + privateThread + '/read')).statusCode).toBe(200);
  expect((await call('GET', '/threads/' + privateThread)).json().thread.queue_status).toBe(
    'to_reply',
  );
  expect((await call('POST', '/threads/' + privateThread + '/start')).statusCode).toBe(200);
  expect((await call('GET', '/threads/' + privateThread)).json().thread.queue_status).toBe(
    'in_progress',
  );
});

it('operador restrito não contorna por URL, resumo, busca, filtros nem anexos', async () => {
  await db
    .updateTable('tenants')
    .set({ settings: asJson({ restrict_operators_to_assigned: true }) })
    .where('id', '=', tenant)
    .execute();
  try {
    expect((await call('GET', '/threads/' + ownThread, operator)).statusCode).toBe(200);
    expect((await call('GET', '/threads/' + otherThread, operator)).statusCode).toBe(404);
    const list = await call('GET', '/mailboxes/' + shared + '/threads?view=search', operator);
    expect(list.statusCode, list.body).toBe(200);
    expect(list.json().items.map((t: { id: string }) => t.id)).toEqual([ownThread]);
    const summary = await call('GET', '/mail-summary/threads?view=search', operator);
    expect(summary.statusCode, summary.body).toBe(200);
    expect(summary.json().total).toBe(1);
    expect((await call('GET', '/search?q=Sigilo', operator)).body).not.toContain(otherThread);
    expect(
      (
        await call(
          'GET',
          '/mailboxes/' + shared + '/threads?view=search&assigned=' + owner,
          operator,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await call(
          'GET',
          '/mailboxes/' + shared + '/threads?view=search&assigned=' + owner,
          supervisor,
        )
      )
        .json()
        .items.map((t: { id: string }) => t.id),
    ).toEqual([otherThread]);
    expect(
      (await call('GET', '/attachments/' + secretAttachment + '/security', operator)).statusCode,
    ).toBe(404);
    expect((await call('GET', '/mail-summary/queue-counts', operator)).json().to_reply).toBe(1);
    const kpis = await call('GET', '/dashboard/kpis?mailbox_id=' + shared, operator);
    expect(kpis.statusCode, kpis.body).toBe(200);
  } finally {
    await db
      .updateTable('tenants')
      .set({ settings: asJson({}) })
      .where('id', '=', tenant)
      .execute();
  }
  expect((await call('GET', '/threads/' + otherThread, operator)).statusCode).toBe(200);
  expect(
    (await call('GET', '/mail-summary/threads?view=search&assigned=' + owner, operator)).statusCode,
  ).toBe(403);
});

it('convite concede apenas a conversa; rascunho inicia e conclusão encerra sem reativar ao reabrir', async () => {
  expect((await call('GET', '/threads/' + privateThread, guest)).statusCode).toBe(404);
  const invited = await call('POST', '/threads/' + privateThread + '/invitations', owner, {
    user_id: guest,
  });
  expect(invited.statusCode, invited.body).toBe(201);
  expect((await call('GET', '/thread-invitations', guest)).json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        thread_id: privateThread,
        mailbox_id: privateBox,
        inviter_name: 'Dono QA',
      }),
    ]),
  );
  expect((await call('GET', '/mailboxes', guest)).json()).toEqual([]);
  expect((await call('GET', '/mailboxes/' + privateBox, guest)).statusCode).toBe(404);
  const detail = await call('GET', '/threads/' + privateThread, guest);
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json()).toMatchObject({ delegated: true, mailbox: { id: privateBox } });
  expect((await call('GET', '/threads/' + secretThread, guest)).statusCode).toBe(404);
  expect(
    (await call('GET', '/attachments/' + secretAttachment + '/security', guest)).statusCode,
  ).toBe(404);
  expect(
    (await call('GET', '/attachments/' + privateAttachment + '/security', guest)).statusCode,
  ).toBe(200);
  const boundary = 'service-qa-' + randomUUID();
  const multipart = Buffer.from(
    '--' +
      boundary +
      '\r\nContent-Disposition: form-data; name="file"; filename="qa.txt"\r\nContent-Type: text/plain\r\n\r\nAnexo sintético\r\n--' +
      boundary +
      '--\r\n',
  );
  const uploaded = await app.inject({
    method: 'POST',
    url: '/api/uploads?mailbox_id=' + privateBox + '&thread_id=' + privateThread,
    headers: {
      origin,
      cookie: cookies.get(guest)!,
      'content-type': 'multipart/form-data; boundary=' + boundary,
    },
    payload: multipart,
  });
  expect(uploaded.statusCode, uploaded.body).toBe(201);
  expect(
    (await call('GET', '/uploads/' + uploaded.json().id + '/security', guest)).statusCode,
  ).toBe(200);
  expect(
    (await call('POST', '/threads/' + privateThread + '/invitations', guest, { user_id: operator }))
      .statusCode,
  ).toBe(403);
  expect(
    (
      await call('POST', '/outbox', guest, {
        mailbox_id: privateBox,
        kind: 'new',
        subject: 'Não autorizado',
        body_html: '<p>QA</p>',
      })
    ).statusCode,
  ).toBe(404);
  const body = {
    mailbox_id: privateBox,
    kind: 'reply',
    thread_id: privateThread,
    reply_to_message_id: privateMessage,
    subject: '',
    body_html: '<p>Rascunho QA</p>',
    to_addresses: [{ address: 'cliente@service.test', name: '' }],
  };
  const malicious = await call('POST', '/outbox', guest, {
    ...body,
    attachments: [{ source: 'message_attachment', attachment_id: secretAttachment }],
  });
  expect(malicious.statusCode, malicious.body).toBe(404);
  const draft = await call('POST', '/outbox', guest, body);
  expect(draft.statusCode, draft.body).toBe(201);
  expect(draft.json().can_edit).toBe(true);
  expect((await call('GET', '/threads/' + privateThread, owner)).json().thread.queue_status).toBe(
    'in_progress',
  );
  expect((await call('GET', '/outbox/' + draft.json().id, guest)).statusCode).toBe(200);
  expect((await call('GET', '/outbox?tab=drafts', guest)).json().items).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: draft.json().id })]),
  );
  expect((await call('POST', '/outbox/' + draft.json().id + '/submit', guest, {})).statusCode).toBe(
    400,
  );
  const task = await db
    .insertInto('reminders')
    .values({
      tenant_id: tenant,
      user_id: owner,
      created_by: owner,
      thread_id: privateThread,
      title: 'Tarefa QA',
      due_at: new Date(Date.now() + 3600000),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  expect((await call('POST', '/threads/' + privateThread + '/done', guest)).statusCode).toBe(409);
  expect((await call('GET', '/thread-invitations', guest)).json()).toHaveLength(1);
  await db
    .updateTable('reminders')
    .set({ status: 'completed' })
    .where('id', '=', task.id)
    .execute();
  expect((await call('POST', '/threads/' + privateThread + '/done', guest)).statusCode).toBe(200);
  expect((await call('GET', '/thread-invitations', guest)).json()).toEqual([]);
  expect((await call('GET', '/threads/' + privateThread, guest)).statusCode).toBe(404);
  expect(await invitationAllowsPermission(db, tenant, guest, privateThread, 'send')).toBe(false);
  expect((await call('GET', '/outbox/' + draft.json().id, guest)).statusCode).toBe(404);
  expect(
    (await call('GET', '/uploads/' + uploaded.json().id + '/security', guest)).statusCode,
  ).toBe(404);
  expect((await call('POST', '/threads/' + privateThread + '/reopen', owner)).statusCode).toBe(200);
  expect((await call('GET', '/thread-invitations', guest)).json()).toEqual([]);
  expect((await call('GET', '/threads/' + privateThread, guest)).statusCode).toBe(404);
});

it('nega visualizadores, outras empresas e revoga convites imediatamente', async () => {
  expect((await call('POST', '/threads/' + ownThread + '/start', viewer)).statusCode).toBe(403);
  expect(
    (await call('POST', '/threads/' + ownThread + '/invitations', owner, { user_id: foreign }))
      .statusCode,
  ).toBe(404);
  expect(
    (await call('POST', '/threads/' + ownThread + '/invitations', viewer, { user_id: guest }))
      .statusCode,
  ).toBe(403);
  const created = await call('POST', '/threads/' + ownThread + '/invitations', operator, {
    user_id: guest,
  });
  expect(created.statusCode, created.body).toBe(201);
  expect((await call('GET', '/threads/' + ownThread, guest)).statusCode).toBe(200);
  expect(
    (await call('DELETE', '/threads/' + ownThread + '/invitations/' + created.json().id, operator))
      .statusCode,
  ).toBe(200);
  expect((await call('GET', '/threads/' + ownThread, guest)).statusCode).toBe(404);
  expect((await call('GET', '/thread-invitations', foreign)).json()).toEqual([]);
  const forViewer = await call('POST', '/threads/' + ownThread + '/invitations', operator, {
    user_id: viewer,
  });
  expect(forViewer.statusCode, forViewer.body).toBe(201);
  expect((await call('GET', '/threads/' + ownThread, viewer)).json()).toMatchObject({
    my_role: 'editor',
    delegated: true,
  });
  expect(
    (
      await call(
        'DELETE',
        '/threads/' + ownThread + '/invitations/' + forViewer.json().id,
        operator,
      )
    ).statusCode,
  ).toBe(200);
  expect((await call('GET', '/threads/' + ownThread, viewer)).json().my_role).toBe('viewer');
});

it('resumo filtra caixa, responsável, status e período no servidor', async () => {
  const list = await call(
    'GET',
    '/mail-summary/threads?view=search&mailbox_id=' +
      shared +
      '&assigned=' +
      owner +
      '&status=to_reply&from=2000-01-01&until=2099-01-01',
    supervisor,
  );
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().items.map((t: { id: string }) => t.id)).toEqual([otherThread]);
  expect(
    (await call('GET', '/mail-summary/threads?view=search&mailbox_id=' + privateBox, supervisor))
      .statusCode,
  ).toBe(404);
  expect(
    (await call('GET', '/mailboxes/' + privateBox + '/threads?view=queue', owner)).json().total,
  ).toBe(0);
});

it('supervisor atribui ao operador restrito e o atendimento continua A Responder', async () => {
  await db
    .updateTable('tenants')
    .set({ settings: asJson({ restrict_operators_to_assigned: true }) })
    .where('id', '=', tenant)
    .execute();
  expect((await call('GET', '/threads/' + otherThread, operator)).statusCode).toBe(404);
  const assigned = await call('PUT', '/threads/' + otherThread + '/assignee', supervisor, {
    user_id: operator,
  });
  expect(assigned.statusCode, assigned.body).toBe(200);
  const detail = await call('GET', '/threads/' + otherThread, operator);
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json().thread).toMatchObject({
    queue_status: 'to_reply',
    assigned_to: { id: operator },
  });
});

it('separa espera na caixa do tempo de cada responsável após transferências', async () => {
  const id = randomUUID();
  const inboundAt = new Date(Date.now() - 30 * 3600000);
  const folder = await db
    .selectFrom('folders')
    .select('id')
    .where('mailbox_id', '=', shared)
    .where('special_use', '=', 'inbox')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('threads')
    .values({
      id,
      tenant_id: tenant,
      mailbox_id: shared,
      subject: 'Relógios de SLA',
      history_queue_eligible: true,
    })
    .execute();
  await db
    .insertInto('messages')
    .values({
      tenant_id: tenant,
      mailbox_id: shared,
      thread_id: id,
      folder_id: folder.id,
      direction: 'inbound',
      message_at: inboundAt,
      message_id_header: '<' + id + '@service.test>',
      from_address: 'cliente@service.test',
      subject: 'Relógios de SLA',
    })
    .execute();
  await touchThreads(db, [id], 'inbound', null);
  const url = '/threads/' + id;
  const assign = async (user_id: string) => {
    const result = await call('PUT', url + '/assignee', supervisor, { user_id });
    expect(result.statusCode, result.body).toBe(200);
  };
  await assign(operator);
  const first = await call('GET', url, operator);
  expect(first.json().thread).toMatchObject({ is_overdue: true, is_assignee_overdue: false });
  await assign(operator);
  await assign(owner);
  const visible = await call(
    'GET',
    '/mail-summary/threads?view=search&q=Rel%C3%B3gios%20de%20SLA',
    supervisor,
  );
  expect(visible.json().items).toEqual([
    expect.objectContaining({
      id,
      is_overdue: true,
      is_assignee_overdue: false,
      assigned_to: expect.objectContaining({ id: owner }),
    }),
  ]);
  const history = (await call('GET', url + '/history', supervisor))
    .json<
      {
        type: string;
        assignee_id: string | null;
        duration_minutes: number;
        ended_at: string | null;
      }[]
    >()
    .filter((entry) => entry.type === 'service_period');
  expect(history.map((entry) => entry.assignee_id)).toEqual([null, operator, owner]);
  expect(history[0]?.duration_minutes).toBeGreaterThanOrEqual(1800);
  expect(history[1]?.ended_at).toBeTruthy();
  expect(history[2]?.ended_at).toBeNull();
  expect((await call('GET', url + '/history', foreign)).statusCode).toBe(404);

  const periodFilter = '?mailbox_id=' + shared;
  const dashboard = await call('GET', '/dashboard/stale-threads' + periodFilter);
  expect(dashboard.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        thread_id: id,
        is_overdue: true,
        is_assignee_overdue: false,
        assigned_minutes: 0,
      }),
    ]),
  );
  const from = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const to = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const productivity = await call(
    'GET',
    '/dashboard/by-user?mailbox_id=' + shared + '&from=' + from + '&to=' + to,
  );
  expect(productivity.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        user_id: operator,
        avg_service_minutes: expect.any(Number),
      }),
    ]),
  );
  expect((await call('POST', url + '/done')).statusCode).toBe(200);
  expect((await call('POST', url + '/reopen')).statusCode).toBe(200);
  const periods = await db
    .selectFrom('thread_service_periods')
    .selectAll()
    .where('thread_id', '=', id)
    .orderBy('id')
    .execute();
  expect(periods.map(({ assignee_id }) => assignee_id)).toEqual([null, operator, owner, owner]);
  expect(periods.filter(({ ended_at }) => ended_at === null)).toHaveLength(1);
});
