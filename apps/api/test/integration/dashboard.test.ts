import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createDb, migrate, asJson } from '@apmail/db';
import type {
  DashboardKpis,
  DailyVolume,
  FolderVolume,
  DashboardQueue,
  UserProductivity,
  StaleThread,
} from '@apmail/shared';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';
const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Banco exclusivo de testes obrigatório.');
const db = createDb(url),
  tenant = randomUUID(),
  otherTenant = randomUUID(),
  box = randomUUID(),
  otherBox = randomUUID(),
  foreignBox = randomUUID(),
  owner = randomUUID(),
  admin = randomUUID(),
  editor = randomUUID(),
  viewer = randomUUID(),
  outsider = randomUUID();
const inbox = randomUUID(),
  junk = randomUUID(),
  trash = randomUUID(),
  otherInbox = randomUUID();
const threads = Object.fromEntries('ABCDEFGHIJ'.split('').map((name) => [name, randomUUID()]));
const origin = 'http://localhost:5173',
  cookies = new Map<string, string>();
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redisUrl,
    APP_URL: origin,
    SESSION_SECRET: randomBytes(32).toString('base64'),
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  }),
);
const params = `from=2026-01-01&to=2026-01-03`;
const call = (endpoint: string, user: string = owner, query = params + '&mailbox_id=' + box) =>
  app.inject({
    method: 'GET',
    url: '/api/dashboard/' + endpoint + '?' + query,
    headers: { origin, cookie: cookies.get(user)! },
  });
async function msg(
  thread: string,
  at: string,
  direction: 'inbound' | 'outbound' = 'inbound',
  user: string | null = null,
  folder: string = inbox,
  automated = false,
  deleted = false,
  mailbox: string = box,
) {
  await db
    .insertInto('messages')
    .values({
      tenant_id: tenant,
      mailbox_id: mailbox,
      thread_id: threads[thread]!,
      folder_id: folder,
      message_id_header: '<' + randomUUID() + '@dashboard.test>',
      subject: thread,
      from_address: 'qa@apmail.local',
      message_at: new Date(at),
      direction,
      sent_by_user_id: user,
      is_automated: automated,
      deleted_at: deleted ? new Date() : null,
    })
    .execute();
}
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      {
        id: tenant,
        name: 'Dashboard QA',
        slug: 'dash-' + tenant,
        timezone: 'America/Sao_Paulo',
        settings: asJson({ sla_first_response_hours: 1 }),
      },
      { id: otherTenant, name: 'Outra empresa', slug: 'dash-' + otherTenant },
    ])
    .execute();
  for (const [id, role] of [
    [owner, 'owner'],
    [admin, 'member'],
    [editor, 'member'],
    [viewer, 'member'],
    [outsider, 'member'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@dash.test',
        full_name:
          id === editor ? 'Editor fixo' : id === admin ? 'Administrador de caixa' : 'Usuário ' + id,
        password_hash: 'session-fixture',
        current_tenant_id: tenant,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tenant, user_id: id, role })
      .execute();
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
  for (const [id, tid, name] of [
    [box, tenant, 'Principal'],
    [otherBox, tenant, 'Outra caixa'],
    [foreignBox, otherTenant, 'Caixa estrangeira'],
  ]) {
    await db
      .insertInto('mailboxes')
      .values({
        id: id!,
        tenant_id: tid!,
        name: name!,
        email_address: id + '@apmail.local',
        username: 'qa',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        status: 'disabled',
      })
      .execute();
  }
  await db
    .insertInto('mailbox_members')
    .values([
      { tenant_id: tenant, mailbox_id: box, user_id: admin, role: 'mailbox_admin' },
      { tenant_id: tenant, mailbox_id: box, user_id: editor, role: 'editor' },
      { tenant_id: tenant, mailbox_id: box, user_id: viewer, role: 'viewer' },
      { tenant_id: tenant, mailbox_id: otherBox, user_id: outsider, role: 'editor' },
    ])
    .execute();
  for (const [id, mailbox, special] of [
    [inbox, box, 'inbox'],
    [junk, box, 'junk'],
    [trash, box, 'trash'],
    [otherInbox, otherBox, 'inbox'],
  ] as const) {
    await db
      .insertInto('folders')
      .values({
        id,
        tenant_id: tenant,
        mailbox_id: mailbox,
        name: special,
        imap_path: special,
        special_use: special,
      })
      .execute();
  }
  const states = {
    A: 'done',
    B: 'awaiting_reply',
    C: 'to_reply',
    D: 'in_progress',
    E: 'none',
    F: 'none',
    G: 'none',
    H: 'none',
    I: 'awaiting_reply',
    J: 'scheduled',
  } as const;
  for (const [name, status] of Object.entries(states)) {
    const first = {
      A: '2026-01-01T03:00:00Z',
      B: '2025-12-31T22:00:00Z',
      C: '2026-01-02T05:00:00Z',
      D: '2026-01-02T06:00:00Z',
      I: '2026-01-02T11:00:00Z',
      J: '2026-01-03T03:00:00Z',
    }[name];
    const response = {
      A: '2026-01-01T05:00:00Z',
      B: '2026-01-01T04:00:00Z',
      I: '2026-01-02T12:00:00Z',
    }[name];
    await db
      .insertInto('threads')
      .values({
        id: threads[name]!,
        tenant_id: tenant,
        mailbox_id: name === 'I' ? otherBox : box,
        subject: name,
        queue_status: status,
        assigned_to: name === 'D' ? editor : null,
        first_inbound_at: first ? new Date(first) : null,
        last_inbound_at: first ? new Date(first) : null,
        first_response_at: response ? new Date(response) : null,
        deleted_at: name === 'H' ? new Date() : null,
      })
      .execute();
  }
  await msg('A', '2026-01-01T03:00:00Z');
  await msg('A', '2026-01-01T05:00:00Z', 'outbound', editor);
  await msg('A', '2026-01-01T06:00:00Z', 'outbound', editor);
  await msg('A', '2026-01-02T03:30:00Z');
  await msg('A', '2026-01-02T04:00:00Z', 'outbound', editor);
  await msg('B', '2025-12-31T22:00:00Z');
  await msg('B', '2026-01-01T04:00:00Z', 'outbound', admin);
  await msg('C', '2026-01-02T05:00:00Z');
  await msg('D', '2026-01-02T06:00:00Z');
  await msg('E', '2026-01-02T07:00:00Z', 'inbound', null, inbox, true);
  await msg('F', '2026-01-02T08:00:00Z', 'inbound', null, junk);
  await msg('G', '2026-01-02T09:00:00Z', 'inbound', null, trash);
  await msg('G', '2026-01-02T09:10:00Z', 'outbound', null, trash);
  await msg('H', '2026-01-02T10:00:00Z', 'inbound', null, inbox, false, true);
  await msg('I', '2026-01-02T11:00:00Z', 'inbound', null, otherInbox, false, false, otherBox);
  await msg('I', '2026-01-02T12:00:00Z', 'outbound', owner, otherInbox, false, false, otherBox);
  await msg('J', '2026-01-03T03:00:00Z');
  await db
    .insertInto('thread_status_history')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      thread_id: threads.A!,
      from_status: 'awaiting_reply',
      to_status: 'done',
      changed_by: editor,
      reason: 'manual',
      created_at: new Date('2026-01-03T05:00:00Z'),
    })
    .execute();
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
it('KPIs e dias conferem período inclusivo no fuso e estado atual independente dele', async () => {
  const response = await call('kpis');
  expect(response.statusCode).toBe(200);
  expect(response.json<DashboardKpis>()).toEqual({
    received: 6,
    sent: 5,
    sent_via_apmail: 4,
    to_reply: 1,
    in_progress: 1,
    awaiting_reply: 1,
    scheduled: 1,
    overdue: 2,
    avg_first_response_minutes: 120,
    response_rate: 25,
    active_users: 4,
  });
  expect((await call('daily-volume')).json<DailyVolume[]>()).toEqual([
    { day: '2026-01-01', received: 1, sent: 3 },
    { day: '2026-01-02', received: 4, sent: 2 },
    { day: '2026-01-03', received: 1, sent: 0 },
  ]);
  expect(
    (await call('daily-volume', owner, 'from=2026-01-04&to=2026-01-05&mailbox_id=' + box)).json(),
  ).toEqual([
    { day: '2026-01-04', received: 0, sent: 0 },
    { day: '2026-01-05', received: 0, sent: 0 },
  ]);
  expect(
    (await call('kpis', owner, 'from=2026-01-04&to=2026-01-05&mailbox_id=' + box)).json(),
  ).toMatchObject({
    received: 0,
    sent: 0,
    to_reply: 1,
    overdue: 2,
    avg_first_response_minutes: null,
    response_rate: 0,
  });
  expect((await call('kpis', owner, params)).json()).toMatchObject({
    received: 7,
    sent: 6,
    avg_first_response_minutes: 90,
    response_rate: 40,
    active_users: 5,
  });
});
it('pastas, cinco filas, produtividade com anterior fora do período e mais antigas conferem', async () => {
  const folders = (await call('by-folder')).json<FolderVolume[]>();
  expect(folders.map((f) => [f.folder_name, f.received, f.sent])).toEqual([
    ['inbox', 5, 4],
    ['trash', 1, 1],
  ]);
  expect((await call('queue-counts')).json<DashboardQueue[]>()).toEqual(
    ['to_reply', 'in_progress', 'awaiting_reply', 'scheduled', 'done'].map((status) => ({
      status,
      count: 1,
    })),
  );
  const users = (await call('by-user')).json<UserProductivity[]>();
  expect(users.find((u) => u.user_id === editor)).toMatchObject({
    sent: 3,
    threads_replied: 1,
    avg_reply_minutes: 75,
    open_assigned: 1,
    done_in_period: 1,
  });
  expect(users.find((u) => u.user_id === admin)).toMatchObject({
    sent: 1,
    threads_replied: 1,
    avg_reply_minutes: 360,
    open_assigned: 0,
    done_in_period: 0,
  });
  expect(users.some((u) => u.user_id === outsider)).toBe(false);
  const stale = (await call('stale-threads')).json<StaleThread[]>();
  expect(stale.map((t) => [t.subject, t.queue_status, t.is_overdue])).toEqual([
    ['C', 'to_reply', true],
    ['D', 'in_progress', true],
  ]);
  expect(stale.every((t) => t.waiting_minutes > 0)).toBe(true);
  expect(
    (await call('stale-threads', owner, params + '&mailbox_id=' + box + '&limit=1')).json(),
  ).toHaveLength(1);
});
it('todas as consultas negam editor/leitor e isolam caixa administrada e empresa', async () => {
  for (const endpoint of [
    'kpis',
    'daily-volume',
    'by-folder',
    'queue-counts',
    'by-user',
    'stale-threads',
  ]) {
    expect((await call(endpoint, editor)).statusCode).toBe(403);
    expect((await call(endpoint, viewer, params)).statusCode).toBe(403);
    expect((await call(endpoint, admin, params + '&mailbox_id=' + otherBox)).statusCode).toBe(404);
    expect((await call(endpoint, owner, params + '&mailbox_id=' + foreignBox)).statusCode).toBe(
      404,
    );
    expect((await call(endpoint, admin, params)).statusCode).toBe(200);
  }
  expect((await call('kpis', admin, params)).json()).toMatchObject({ received: 6, sent: 5 });
}, 20000);
it('limites e validações rejeitam datas inválidas e revelam mudanças de acesso imediatamente', async () => {
  for (const query of [
    'from=2026-02-30',
    'from=2026-01-03&to=2026-01-01',
    'from=2024-01-01&to=2026-01-01',
    'limit=101',
    'mailbox_id=invalid',
  ])
    expect((await call('kpis', owner, query)).statusCode).toBe(400);
  // Último segundo do dia anterior não entra; primeiro segundo após o fim também não entra.
  await msg('A', '2026-01-01T02:59:59Z');
  await msg('A', '2026-01-04T03:00:00Z');
  expect((await call('kpis')).json()).toMatchObject({ received: 6 });
  await db
    .updateTable('tenant_members')
    .set({ status: 'disabled' })
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', editor)
    .execute();
  expect((await call('kpis')).json()).toMatchObject({ active_users: 3 });
  expect(
    (await call('by-user')).json<UserProductivity[]>().find((u) => u.user_id === editor),
  ).toMatchObject({ sent: 3, done_in_period: 1 });
  await db
    .updateTable('mailbox_members')
    .set({ role: 'editor' })
    .where('user_id', '=', admin)
    .where('mailbox_id', '=', box)
    .execute();
  expect((await call('kpis', admin, params)).statusCode).toBe(403);
});
