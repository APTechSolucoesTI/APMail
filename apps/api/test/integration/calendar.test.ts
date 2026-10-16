import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDb,
  migrate,
  asJson,
  sweepCalendarReminders,
  applyCalendarMessage,
  eventInvite,
} from '@apmail/db';
import { calendarInviteSchema, type CalendarInvite } from '@apmail/shared';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';
const url = process.env.DATABASE_URL_TEST!,
  redis = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Banco de teste exclusivo obrigatório.');
const db = createDb(url),
  tenant = randomUUID(),
  foreignTenant = randomUUID(),
  owner = randomUUID(),
  member = randomUUID(),
  foreign = randomUUID(),
  box = randomUUID(),
  origin = 'http://localhost:5173',
  secret = randomBytes(32).toString('base64');
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redis,
    APP_URL: origin,
    SESSION_SECRET: secret,
    CREDENTIALS_ENCRYPTION_KEY: secret,
    STORAGE_DIR: join(tmpdir(), 'apmail-calendar-' + tenant),
  }),
);
const cookies = new Map<string, string>();
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  user = owner,
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
let calendarId: string, eventId: string, inviteMessage: string;
const base = {
  title: 'Revisão de produto',
  starts_at: '2030-10-15T17:00:00.000Z',
  ends_at: '2030-10-15T18:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  reminder_minutes: 30,
};
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Calendário QA', slug: 'cal-' + tenant },
      { id: foreignTenant, name: 'Outra QA', slug: 'cal-' + foreignTenant },
    ])
    .execute();
  for (const [id, tid, role] of [
    [owner, tenant, 'owner'],
    [member, tenant, 'member'],
    [foreign, foreignTenant, 'owner'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@qa.example',
        full_name: 'Calendário QA',
        password_hash: 'test-only',
        current_tenant_id: tid,
      })
      .execute();
    await db.insertInto('tenant_members').values({ tenant_id: tid, user_id: id, role }).execute();
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
  await db
    .insertInto('mailboxes')
    .values({
      id: box,
      tenant_id: tenant,
      name: 'Convites QA',
      email_address: 'calendar-' + box + '@qa.example',
      smtp_host: '127.0.0.1',
      smtp_port: 1,
      imap_host: '127.0.0.1',
      username: 'qa',
      status: 'active',
    })
    .execute();
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
it('exige autenticação e cria calendários pessoais isolados', async () => {
  expect((await app.inject({ url: '/api/calendars' })).statusCode).toBe(401);
  const own = await call('GET', '/api/calendars');
  expect(own.statusCode).toBe(200);
  calendarId = own.json()[0].id;
  const other = await call('GET', '/api/calendars', undefined, member);
  expect(other.json().some((c: { id: string }) => c.id === calendarId)).toBe(false);
  expect(
    (await call('POST', '/api/calendar/events', { ...base, calendar_id: calendarId }, member))
      .statusCode,
  ).toBe(404);
});
it('cria, consulta, filtra, edita e impede sobrescrita concorrente', async () => {
  const created = await call('POST', '/api/calendar/events', {
    ...base,
    calendar_id: calendarId,
    category: 'Trabalho',
    is_private: true,
  });
  expect(created.statusCode).toBe(200);
  eventId = created.json().id;
  expect((await call('GET', '/api/calendar/events/' + eventId, undefined, member)).statusCode).toBe(
    404,
  );
  expect(
    (await call('GET', '/api/calendar/events/' + eventId, undefined, foreign)).statusCode,
  ).toBe(404);
  const range = '/api/calendar/events?from=2030-10-01T00:00:00.000Z&to=2030-11-01T00:00:00.000Z';
  expect(
    (await call('GET', range)).json().some((e: { event_id: string }) => e.event_id === eventId),
  ).toBe(true);
  expect((await call('GET', range + '&search=NoMatch')).json()).toEqual([]);
  const updated = await call('PATCH', '/api/calendar/events/' + eventId, {
    ...created.json<Record<string, unknown>>(),
    title: 'Revisão atualizada',
    version: 0,
  });
  expect(updated.statusCode).toBe(200);
  expect(
    (
      await call('PATCH', '/api/calendar/events/' + eventId, {
        ...created.json<Record<string, unknown>>(),
        title: 'Obsoleto',
        version: 0,
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await call('GET', '/api/calendar/events/' + eventId + '/ics')).headers['content-type'],
  ).toContain('text/calendar');
});
it('expande série, reagenda e cancela somente uma ocorrência', async () => {
  const created = await call('POST', '/api/calendar/events', {
    ...base,
    calendar_id: calendarId,
    title: 'Série QA',
    rrule: 'FREQ=DAILY;COUNT=3',
  });
  const e = created.json();
  const moved = await call('POST', '/api/calendar/events/' + e.id + '/occurrence', {
    original: base.starts_at,
    start: '2030-10-15T19:00:00.000Z',
    end: '2030-10-15T20:00:00.000Z',
    cancelled: false,
    version: 0,
  });
  expect(moved.statusCode).toBe(200);
  expect(
    (
      await call('POST', '/api/calendar/events/' + e.id + '/occurrence', {
        original: '2030-10-16T17:00:00.000Z',
        cancelled: true,
        version: 1,
      })
    ).statusCode,
  ).toBe(200);
  const list = (
    await call(
      'GET',
      '/api/calendar/events?from=2030-10-01T00:00:00.000Z&to=2030-11-01T00:00:00.000Z&search=Série',
    )
  ).json();
  expect(list).toHaveLength(2);
  expect(list.find((v: { original: string }) => v.original === base.starts_at).start).toBe(
    '2030-10-15T19:00:00.000Z',
  );
});
it('salva reuniões e convites na mesma transação; recebe respostas e cancelamentos', async () => {
  const response = await call('POST', '/api/calendar/events', {
    ...base,
    calendar_id: calendarId,
    mailbox_id: box,
    attendees: [
      { address: 'guest@qa.example', name: 'Convidado' },
      { address: 'guest@qa.example', name: 'Duplicado' },
    ],
  });
  expect(response.statusCode).toBe(200);
  const e = response.json();
  const outbox = await db
    .selectFrom('outbox')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .where('calendar_payload', 'is not', null)
    .execute();
  expect(outbox).toHaveLength(1);
  expect(calendarInviteSchema.parse(outbox[0]!.calendar_payload).method).toBe('REQUEST');
  expect(outbox[0]!.to_addresses).toHaveLength(1);
  const row = await db
    .selectFrom('calendar_events')
    .selectAll()
    .where('id', '=', e.id)
    .executeTakeFirstOrThrow();
  const reply = {
    ...eventInvite(row, 'REPLY'),
    dtstamp: '2030-10-15T12:00:00.000Z',
    attendees: [{ address: 'guest@qa.example', name: 'Convidado', status: 'ACCEPTED' as const }],
  };
  await db
    .transaction()
    .execute((tx) => applyCalendarMessage(tx, reply, tenant, box, 'attacker@qa.example'));
  expect((await call('GET', '/api/calendar/events/' + e.id)).json().attendees[0].status).toBe(
    'NEEDS-ACTION',
  );
  await db
    .transaction()
    .execute((tx) => applyCalendarMessage(tx, reply, tenant, box, 'guest@qa.example'));
  expect((await call('GET', '/api/calendar/events/' + e.id)).json().attendees[0].status).toBe(
    'ACCEPTED',
  );
  const answered = (await call('GET', '/api/calendar/events/' + e.id)).json();
  expect(answered.sequence).toBe(1);
  expect(answered.schedule_sequence).toBe(0);
  await db
    .transaction()
    .execute((tx) => applyCalendarMessage(tx, reply, tenant, box, 'guest@qa.example'));
  expect((await call('GET', '/api/calendar/events/' + e.id)).json().sequence).toBe(1);
  expect((await call('DELETE', '/api/calendar/events/' + e.id, { version: 0 })).statusCode).toBe(
    409,
  );
  expect(
    (await call('DELETE', '/api/calendar/events/' + e.id, { version: answered.sequence }))
      .statusCode,
  ).toBe(200);
  const cancel = await db
    .selectFrom('outbox')
    .select('calendar_payload')
    .where('tenant_id', '=', tenant)
    .where('subject', 'like', 'Cancelado:%')
    .executeTakeFirstOrThrow();
  expect(calendarInviteSchema.parse(cancel.calendar_payload).method).toBe('CANCEL');
});
it('aceita convite uma vez, persiste RSVP e recebe atualização/cancelamento do organizador', async () => {
  const folder = await db
    .insertInto('folders')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      name: 'Entrada',
      imap_path: 'INBOX',
      special_use: 'inbox',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const thread = await db
    .insertInto('threads')
    .values({ tenant_id: tenant, mailbox_id: box, subject_normalized: 'meeting' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const invite: CalendarInvite = calendarInviteSchema.parse({
    ...base,
    uid: randomUUID() + '@qa.example',
    method: 'REQUEST',
    sequence: 0,
    title: 'Convite recebido',
    description: '',
    location: 'Sala',
    organizer: 'external@qa.example',
    attendees: [{ address: 'calendar-' + box + '@qa.example', name: 'QA' }],
    rrule: 'FREQ=DAILY;COUNT=3',
    all_day: false,
  });
  const m = await db
    .insertInto('messages')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      folder_id: folder.id,
      thread_id: thread.id,
      from_address: invite.organizer,
      subject: invite.title,
      direction: 'inbound',
      message_id_header: '<' + randomUUID() + '@qa.example>',
      message_at: new Date(),
      calendar_invite: asJson(invite),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  inviteMessage = m.id;
  const accepted = await call('POST', '/api/messages/' + m.id + '/calendar/respond', {
    status: 'ACCEPTED',
  });
  expect(accepted.statusCode).toBe(200);
  const count = async () =>
    (
      await db
        .selectFrom('outbox')
        .select('id')
        .where('tenant_id', '=', tenant)
        .where('subject', '=', 'Resposta: ' + invite.title)
        .execute()
    ).length;
  expect(await count()).toBe(1);
  expect(
    (await call('POST', '/api/messages/' + m.id + '/calendar/respond', { status: 'ACCEPTED' }))
      .statusCode,
  ).toBe(200);
  expect(await count()).toBe(1);
  expect(
    (
      await call('PATCH', '/api/calendar/events/' + accepted.json().id + '/preferences', {
        calendar_id: calendarId,
        reminder_minutes: 5,
        version: 0,
      })
    ).statusCode,
  ).toBe(200);
  const exceptionInvite = {
    ...invite,
    sequence: 1,
    recurrence_id: invite.starts_at,
    starts_at: '2030-10-15T19:00:00.000Z',
    ends_at: '2030-10-15T20:00:00.000Z',
    rrule: null,
  };
  await db
    .transaction()
    .execute((tx) => applyCalendarMessage(tx, exceptionInvite, tenant, box, invite.organizer));
  const exceptionMessage = await db
    .insertInto('messages')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      folder_id: folder.id,
      thread_id: thread.id,
      from_address: invite.organizer,
      subject: invite.title,
      direction: 'inbound',
      message_id_header: '<' + randomUUID() + '@qa.example>',
      message_at: new Date(),
      calendar_invite: asJson(exceptionInvite),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  expect(
    (
      await call('POST', '/api/messages/' + exceptionMessage.id + '/calendar/respond', {
        status: 'ACCEPTED',
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (
      await call('POST', '/api/messages/' + exceptionMessage.id + '/calendar/respond', {
        status: 'ACCEPTED',
      })
    ).statusCode,
  ).toBe(200);
  expect(await count()).toBe(2);
  const preserved = (await call('GET', '/api/calendar/events/' + accepted.json().id)).json();
  expect(preserved.rrule).toBe(invite.rrule);
  expect(preserved.starts_at).toBe(invite.starts_at);
  expect(preserved.exceptions[0].attendees[0].response_sequence).toBe(1);
  await db.transaction().execute((tx) =>
    applyCalendarMessage(
      tx,
      {
        ...invite,
        sequence: 1,
        title: 'Reagendado',
        starts_at: '2030-10-15T20:00:00.000Z',
        ends_at: '2030-10-15T21:00:00.000Z',
      },
      tenant,
      box,
      invite.organizer,
    ),
  );
  expect((await call('GET', '/api/calendar/events/' + accepted.json().id)).json().title).toBe(
    'Reagendado',
  );
  expect(
    (await call('POST', '/api/messages/' + m.id + '/calendar/respond', { status: 'DECLINED' }))
      .statusCode,
  ).toBe(409);
  await db
    .transaction()
    .execute((tx) =>
      applyCalendarMessage(
        tx,
        { ...invite, method: 'CANCEL', sequence: 2 },
        tenant,
        box,
        invite.organizer,
      ),
    );
  expect((await call('GET', '/api/calendar/events/' + accepted.json().id)).json().status).toBe(
    'cancelled',
  );
  expect(
    (await call('GET', '/api/messages/' + inviteMessage + '/calendar', undefined, foreign))
      .statusCode,
  ).toBe(404);
});
it('processa lembretes sem navegador, uma vez, e permite adiar/concluir/editar', async () => {
  const response = await call('POST', '/api/reminders', {
    title: 'Lembrete independente QA',
    due_at: new Date(Date.now() - 1000).toISOString(),
    recurrence: { unit: 'day', interval: 1, timezone: 'America/Sao_Paulo', max_occurrences: 2 },
  });
  expect(response.statusCode).toBe(200);
  const reminder = response.json();
  await Promise.all([sweepCalendarReminders(db), sweepCalendarReminders(db)]);
  const notifications = await db
    .selectFrom('notifications')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .where('title', '=', 'Lembrete independente QA')
    .execute();
  expect(notifications).toHaveLength(1);
  expect(
    (
      await call(
        'POST',
        '/api/reminders/' + reminder.id + '/action',
        { action: 'complete' },
        member,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call('POST', '/api/reminders/' + reminder.id + '/action', {
        action: 'snooze',
        minutes: 5,
      })
    ).json().status,
  ).toBe('pending');
  expect(
    (
      await call('PATCH', '/api/reminders/' + reminder.id, {
        title: 'Revisado',
        due_at: new Date(Date.now() + 3600000).toISOString(),
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await call('POST', '/api/reminders/' + reminder.id + '/action', { action: 'complete' })).json()
      .status,
  ).toBe('completed');
});
it('processa a antecedência do evento e evita notificações repetidas', async () => {
  const now = new Date(),
    start = new Date(+now + 5 * 60000),
    end = new Date(+start + 3600000);
  const response = await call('POST', '/api/calendar/events', {
    ...base,
    calendar_id: calendarId,
    title: 'Alarme de compromisso QA',
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    reminder_minutes: 15,
  });
  expect(response.statusCode).toBe(200);
  await sweepCalendarReminders(db);
  await sweepCalendarReminders(db);
  const notices = await db
    .selectFrom('notifications')
    .select('id')
    .where('tenant_id', '=', tenant)
    .where('title', '=', 'Alarme de compromisso QA')
    .execute();
  expect(notices).toHaveLength(1);
});
