import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, migrate, encryptSecret, runMeetSyncPage, scheduleMeetSync } from '@apmail/db';
import { GOOGLE_MEET_SCOPE, GOOGLE_DRIVE_MEET_SCOPE, type MeetJob } from '@apmail/shared';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';
const database = process.env.DATABASE_URL_TEST!,
  redis = process.env.REDIS_URL_TEST!;
if (!database || !new URL(database).pathname.endsWith('_test'))
  throw Error('Exclusive test database required');
const db = createDb(database),
  tenant = randomUUID(),
  foreignTenant = randomUUID(),
  user = randomUUID(),
  colleague = randomUUID(),
  foreignUser = randomUUID(),
  connection = randomUUID(),
  key = randomBytes(32).toString('base64'),
  origin = 'http://localhost:5173';
const env = envSchema.parse({
  NODE_ENV: 'test',
  DATABASE_URL: database,
  REDIS_URL: redis,
  APP_URL: origin,
  SESSION_SECRET: key,
  CREDENTIALS_ENCRYPTION_KEY: key,
  STORAGE_DIR: join(tmpdir(), 'apmail-reports-' + tenant),
  GOOGLE_CLIENT_ID: 'qa-client',
  GOOGLE_CLIENT_SECRET: 'qa-secret',
});
const cookies = new Map<string, string>(),
  requests: string[] = [];
const start = new Date(Date.now() - 3 * 3600000),
  end = new Date(+start + 3600000),
  at = (minutes: number) => new Date(+start + minutes * 60000).toISOString();
let denyTranscript = false,
  failQuota = false,
  withdrawDuringFetch = false;
const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
  const url = new URL(String(input));
  requests.push(url.href);
  if (url.hostname === 'openidconnect.googleapis.com')
    return Response.json({
      sub: 'qa-report-owner',
      email: 'owner@qa.example',
      email_verified: true,
    });
  if (url.hostname === 'www.googleapis.com' && url.pathname.endsWith('/export'))
    return new Response('Decisões da reunião: revisar o contrato.');
  if (url.hostname !== 'meet.googleapis.com') throw Error('Unexpected external request');
  const path = url.pathname.replace('/v2/', ''),
    page = url.searchParams.get('pageToken');
  if (path === 'spaces' && init?.method === 'POST')
    return Response.json({
      name: 'spaces/report-test',
      meetingUri: 'https://meet.google.com/abc-defg-hij',
      config: JSON.parse(String(init.body)).config,
    });
  if (path.startsWith('spaces/')) {
    if (path.includes('/members')) {
      if (init?.method === 'DELETE') return new Response(null, { status: 204 });
      if (init?.method === 'POST')
        return Response.json({
          name: 'spaces/report-test/members/m1',
          ...JSON.parse(String(init.body)),
        });
      return Response.json({
        members: [
          { name: 'spaces/report-test/members/m1', email: 'cohost@qa.example', role: 'COHOST' },
        ],
      });
    }
    return Response.json({
      name: 'spaces/report-test',
      meetingUri: 'https://meet.google.com/abc-defg-hij',
      config:
        init?.method === 'PATCH' ? JSON.parse(String(init.body)).config : { accessType: 'TRUSTED' },
    });
  }
  if (path === 'conferenceRecords') {
    if (failQuota) {
      failQuota = false;
      return Response.json(
        { error: { message: 'do not expose provider secret' } },
        { status: 429 },
      );
    }
    if (withdrawDuringFetch) {
      withdrawDuringFetch = false;
      await db
        .updateTable('google_meet_preferences')
        .set({ artifacts_consent: false, sync_enabled: false })
        .where('tenant_id', '=', tenant)
        .where('user_id', '=', user)
        .execute();
    }
    return Response.json({
      conferenceRecords: [
        {
          name: page ? 'conferenceRecords/c2' : 'conferenceRecords/c1',
          space: 'spaces/report-test',
          startTime: page ? at(30) : at(0),
          endTime: at(60),
        },
      ],
      ...(!page ? { nextPageToken: 'second-conference' } : {}),
    });
  }
  if (path.endsWith('/participantSessions'))
    return Response.json({
      participantSessions: [
        {
          name: path + (page ? '/s2' : '/s1'),
          startTime: page ? at(15) : at(0),
          endTime: page ? at(60) : at(30),
        },
      ],
      ...(!page ? { nextPageToken: 'second-session' } : {}),
    });
  if (path.endsWith('/participants'))
    return Response.json({
      participants: [
        {
          name: path + (page ? '/p2' : '/p1'),
          ...(page
            ? { anonymousUser: { displayName: 'Visitante' } }
            : { signedinUser: { user: 'users/opaque-user', displayName: '=Contato conhecido' } }),
          earliestStartTime: at(0),
          latestEndTime: at(60),
        },
      ],
      ...(!page ? { nextPageToken: 'second-participant' } : {}),
    });
  if (path.endsWith('/recordings'))
    return Response.json({
      recordings: [
        {
          name: path + '/r1',
          state: 'FILE_GENERATED',
          startTime: at(0),
          endTime: at(60),
          driveDestination: {
            file: 'files/recording-doc',
            exportUri: 'https://drive.google.com/file/d/recording-doc/view',
          },
        },
      ],
    });
  if (path.endsWith('/transcripts'))
    return denyTranscript
      ? Response.json(
          {
            error: {
              message: 'private provider response',
              details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
            },
          },
          { status: 403 },
        )
      : Response.json({
          transcripts: [
            {
              name: path + '/t1',
              state: 'FILE_GENERATED',
              startTime: at(0),
              endTime: at(60),
              docsDestination: {
                document: 'transcript-doc',
                exportUri: 'https://docs.google.com/document/d/transcript-doc/edit',
              },
            },
          ],
        });
  if (path.endsWith('/smartNotes'))
    return Response.json({
      smartNotes: [
        {
          name: path + '/n1',
          state: 'FILE_GENERATED',
          docsDestination: {
            document: 'notes-doc',
            exportUri: 'https://docs.google.com/document/d/notes-doc/edit',
          },
        },
      ],
    });
  if (path.endsWith('/entries'))
    return Response.json({
      transcriptEntries: [
        {
          name: path + (page ? '/e2' : '/e1'),
          participant: path.split('/transcripts/')[0] + '/participants/p1',
          text: page
            ? 'Decisão: revisar contrato 100%.'
            : '<script>texto literal</script> Pauta da reunião.',
          startTime: page ? at(20) : at(1),
          endTime: page ? at(21) : at(2),
          languageCode: 'pt-BR',
        },
      ],
      ...(!page ? { nextPageToken: 'second-entry' } : {}),
    });
  throw Error('Unexpected Google resource ' + path);
});
const app = await buildApp(env);
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
  actor = user,
) =>
  app.inject({
    method,
    url: path,
    headers: {
      origin,
      cookie: cookies.get(actor) ?? '',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { payload: JSON.stringify(body) } : {}),
  });
let space: string, event: string, calendar: string, recordId: string;
const preferences = { artifacts_consent: true, sync_enabled: true, retention_days: 90 };
const query = () =>
  new URLSearchParams({
    from: new Date(+start - 86400000).toISOString().slice(0, 10),
    to: new Date(+start + 10 * 86400000).toISOString().slice(0, 10),
  });
const rootJob = (): MeetJob => ({
  kind: 'space',
  connection_id: connection,
  space_id: space,
  resource: 'spaces/report-test',
  generation: randomUUID(),
});
const sync = async () => {
  const jobs = [rootJob()];
  let processed = 0;
  while (jobs.length) {
    if (++processed > 100) throw Error('Unbounded pagination');
    await runMeetSyncPage(db, env, jobs.shift()!, async (job) => {
      jobs.push(job);
    });
  }
  return processed;
};
beforeAll(async () => {
  await migrate(database);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Relatórios QA', slug: 'reports-' + tenant },
      { id: foreignTenant, name: 'Outra empresa', slug: 'reports-' + foreignTenant },
    ])
    .execute();
  for (const [id, tid] of [
    [user, tenant],
    [colleague, tenant],
    [foreignUser, foreignTenant],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@qa.example',
        full_name: 'Relatórios QA',
        password_hash: 'not-a-login',
        current_tenant_id: tid,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tid, user_id: id, role: 'owner' })
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
  await db
    .insertInto('google_connections')
    .values({
      id: connection,
      tenant_id: tenant,
      user_id: user,
      google_subject: 'qa-report-owner',
      email: 'owner@qa.example',
      scopes: [GOOGLE_MEET_SCOPE, GOOGLE_DRIVE_MEET_SCOPE],
      encrypted_tokens: encryptSecret(
        JSON.stringify({ access_token: 'qa-private-access', refresh_token: 'qa-private-refresh' }),
        key,
      ),
      expires_at: new Date(Date.now() + 3600000),
    })
    .execute();
});
afterAll(async () => {
  fetchMock.mockRestore();
  await app.close();
  await db.destroy();
});
it('creates a real API space, stores identifiers, links calendar and enforces consent', async () => {
  const created = await call('POST', '/api/integrations/google/meet', {
    request_id: randomUUID(),
    config: {
      accessType: 'RESTRICTED',
      artifactConfig: { transcriptionConfig: { autoTranscriptionGeneration: 'ON' } },
    },
  });
  expect(created.statusCode, created.body).toBe(200);
  space = created.json().space_id;
  expect(space).toBeTruthy();
  const before = requests.length;
  await sync();
  expect(requests).toHaveLength(before);
  expect(
    (await call('PUT', '/api/integrations/google/meet/preferences', { sync_enabled: true }))
      .statusCode,
  ).toBe(400);
  expect(
    (await call('PUT', '/api/integrations/google/meet/preferences', preferences)).statusCode,
  ).toBe(200);
  const calendars = await call('GET', '/api/calendars');
  calendar = calendars.json()[0].id;
  const saved = await call('POST', '/api/calendar/events', {
    calendar_id: calendar,
    title: 'Revisão técnica',
    starts_at: start.toISOString(),
    ends_at: end.toISOString(),
    timezone: 'America/Sao_Paulo',
    meeting_url: 'https://meet.google.com/abc-defg-hij',
    reminder_minutes: null,
  });
  expect(saved.statusCode, saved.body).toBe(200);
  event = saved.json().id;
  expect(
    await db
      .selectFrom('google_meet_event_links')
      .selectAll()
      .where('space_id', '=', space)
      .where('event_id', '=', event)
      .executeTakeFirst(),
  ).toBeTruthy();
  for (const [title, offset] of [
    ['Futuro', 3],
    ['Sem conferência', -1],
  ] as const) {
    const date = new Date(+start + offset * 86400000);
    const result = await call('POST', '/api/calendar/events', {
      calendar_id: calendar,
      title,
      starts_at: date.toISOString(),
      ends_at: new Date(+date + 3600000).toISOString(),
      meeting_url: 'https://meet.google.com/xyz-abcd-efg',
      timezone: 'America/Sao_Paulo',
      reminder_minutes: null,
    });
    expect(result.statusCode, result.body).toBe(200);
  }
});
it('imports all paginated conferences, participants, sessions, transcripts and notes idempotently', async () => {
  expect(await sync()).toBeGreaterThan(20);
  const records = await db
    .selectFrom('google_meet_records')
    .selectAll()
    .where('connection_id', '=', connection)
    .execute();
  expect(records).toHaveLength(2);
  recordId = records.find((r) => r.resource_name === 'conferenceRecords/c1')!.id;
  const first = await call('GET', '/api/reports/meet/' + recordId);
  expect(first.statusCode, first.body).toBe(200);
  expect(first.json().participants).toHaveLength(2);
  expect(first.json().participants[0].duration_seconds).toBe(3600);
  expect(first.json().participants[0]).not.toHaveProperty('email');
  expect(
    first.json().artifacts.find((a: { kind: string }) => a.kind === 'smart_notes').body_text,
  ).toContain('Decisões');
  const transcript = await call('GET', '/api/reports/meet/' + recordId + '/transcript');
  expect(transcript.json().items).toHaveLength(2);
  expect(
    (await call('GET', '/api/reports/meet/' + recordId + '/transcript?search=100%25')).json().items,
  ).toHaveLength(1);
  await sync();
  expect((await call('GET', '/api/reports/meet/' + recordId)).json().participants).toHaveLength(2);
  expect(
    (await call('GET', '/api/reports/meet/' + recordId + '/transcript')).json().items,
  ).toHaveLength(2);
  expect(requests.some((url) => url.includes('pageToken=second-session'))).toBe(true);
  expect(requests.some((url) => url.includes('pageToken=second-entry'))).toBe(true);
  const projection = await db
    .selectFrom('storage_logical_payloads')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .where('relation_name', '=', 'google_meet_transcript_entries')
    .execute();
  expect(projection).toHaveLength(4);
});
it('distinguishes actual meetings from plans and uses server filters, pagination and timezone', async () => {
  const response = await call('GET', '/api/reports/meet?' + query());
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().summary).toMatchObject({
    completed: 2,
    scheduled: 1,
    unverified: 1,
    total_seconds: 5400,
    average_seconds: 2700,
    participations: 4,
    recordings: 2,
    transcripts: 2,
  });
  expect(response.json().coverage).toMatchObject({ records: 2, participants: 2 });
  expect(response.json()).not.toHaveProperty('all');
  expect(
    (await call('GET', '/api/reports/meet?' + query() + '&status=scheduled')).json().total,
  ).toBe(1);
  expect((await call('GET', '/api/reports/meet?' + query() + '&search=revisao')).json().total).toBe(
    2,
  );
  expect((await call('GET', '/api/reports/meet?' + query() + '&page=2')).json().items).toEqual([]);
  expect(
    (await call('GET', '/api/reports/meet?' + query() + '&sort=duration_asc')).json().items[0]
      .duration_seconds,
  ).toBe(1800);
  expect(
    (await call('GET', '/api/reports/meet?' + query() + '&sort=duration_desc')).json().items[0]
      .duration_seconds,
  ).toBe(3600);
  const planned = response
    .json()
    .items.find((row: { status: string }) => row.status === 'scheduled');
  const detail = await call('GET', '/api/reports/meet/' + encodeURIComponent(planned.id));
  expect(detail.statusCode, detail.body).toBe(200);
  expect(detail.json().record).toBeNull();
  expect(detail.json().event.starts_at).toBe(planned.scheduled_start);
});
it('isolates personal reports from other tenant members and organizations, including exports', async () => {
  for (const actor of [colleague, foreignUser]) {
    expect((await call('GET', '/api/reports/meet/' + recordId, undefined, actor)).statusCode).toBe(
      404,
    );
    expect(
      (await call('GET', '/api/reports/meet/' + recordId + '/export?format=csv', undefined, actor))
        .statusCode,
    ).toBe(404);
    expect((await call('GET', '/api/reports/meet?' + query(), undefined, actor)).json().total).toBe(
      0,
    );
    expect(
      (await call('POST', '/api/integrations/google/meet/spaces/' + space + '/sync', {}, actor))
        .statusCode,
    ).toBe(404);
  }
  expect((await call('GET', '/api/reports/meet/not-a-valid-id')).statusCode).toBe(400);
  expect(
    (await call('GET', '/api/reports/meet/------------------------------------')).statusCode,
  ).toBe(400);
});
it('exports authorized PDF, CSV, safe print HTML and actual transcript TXT/VTT', async () => {
  const pdf = await call('GET', '/api/reports/meet/export?' + query() + '&format=pdf');
  expect(pdf.statusCode, pdf.body.slice(0, 100)).toBe(200);
  expect(pdf.rawPayload.subarray(0, 5).toString()).toBe('%PDF-');
  const csv = await call(
    'GET',
    '/api/reports/meet/' + recordId + '/export?report=participants&format=csv',
  );
  expect(csv.body).toContain("'=Contato conhecido");
  const html = await call(
    'GET',
    '/api/reports/meet/' + recordId + '/export?report=transcript&format=html',
  );
  expect(html.body).not.toContain('<script>');
  expect(html.body).toContain('&lt;script&gt;');
  const vtt = await call(
    'GET',
    '/api/reports/meet/' + recordId + '/export?report=transcript&format=vtt',
  );
  expect(vtt.body).toContain('WEBVTT');
  expect(vtt.body).toContain('00:01:00.000 --> 00:02:00.000');
  expect(
    (await call('GET', '/api/reports/meet/' + recordId + '/export?report=transcript&format=txt'))
      .body,
  ).toContain('Pauta');
});
it('persists Google settings, manages members and never turns denied access into a guessed plan', async () => {
  // Association metadata must not replace Google's authorization decision.
  await db
    .updateTable('google_meet_spaces')
    .set({ app_created: false })
    .where('id', '=', space)
    .execute();
  expect(
    (
      await call(
        'GET',
        '/api/integrations/google/meet/spaces?meeting_url=' +
          encodeURIComponent('https://meet.google.com/xyz-abcd-efg'),
      )
    ).json(),
  ).toEqual([]);
  expect(
    (
      await call('PATCH', '/api/integrations/google/meet/spaces/' + space, {
        accessType: 'RESTRICTED',
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await call('GET', '/api/integrations/google/meet/spaces/' + space + '/members')).json()
      .items[0].role,
  ).toBe('COHOST');
  expect(
    (
      await call('POST', '/api/integrations/google/meet/spaces/' + space + '/members', {
        email: 'cohost@qa.example',
        role: 'COHOST',
      })
    ).statusCode,
  ).toBe(200);
  expect(
    (await call('DELETE', '/api/integrations/google/meet/spaces/' + space + '/members/m1'))
      .statusCode,
  ).toBe(200);
  denyTranscript = true;
  const result = await call('POST', '/api/integrations/google/test', {});
  expect(result.statusCode, result.body).toBe(200);
  expect(result.json().capabilities.transcripts.state).toBe('permission_required');
  expect(result.json().capabilities.automatic.state).toBe('unverified');
  expect(JSON.stringify(result.json())).not.toContain('private provider');
  denyTranscript = false;
  const stored = (await call('GET', '/api/integrations/google')).json();
  expect(stored.preferences).toMatchObject(preferences);
  expect(JSON.stringify(stored)).not.toMatch(/qa-private|qa-secret/);
});
it('keeps structured transcripts working on a declared free plan without Drive permission', async () => {
  await db
    .updateTable('google_connections')
    .set({ scopes: [GOOGLE_MEET_SCOPE] })
    .where('id', '=', connection)
    .execute();
  expect(
    (
      await call('PUT', '/api/integrations/google/meet/preferences', {
        ...preferences,
        declared_plan: 'free',
      })
    ).statusCode,
  ).toBe(200);
  const records = db
    .selectFrom('google_meet_records')
    .select('id')
    .where('connection_id', '=', connection);
  await db
    .updateTable('google_meet_artifacts')
    .set({ body_text: null })
    .where('record_id', 'in', records)
    .execute();
  const before = requests.filter((url) => url.includes('www.googleapis.com/drive/')).length;
  await sync();
  expect(requests.filter((url) => url.includes('www.googleapis.com/drive/'))).toHaveLength(before);
  expect(
    (await call('GET', '/api/reports/meet/' + recordId + '/transcript')).json().items,
  ).toHaveLength(2);
  expect((await call('GET', '/api/integrations/google')).json().preferences.declared_plan).toBe(
    'free',
  );
});
it('recovers quota errors, respects retention and stops imports after consent withdrawal', async () => {
  failQuota = true;
  await expect(runMeetSyncPage(db, env, rootJob(), async () => {})).rejects.toThrow(
    'limite temporário',
  );
  expect(
    (
      await db
        .selectFrom('google_meet_spaces')
        .selectAll()
        .where('id', '=', space)
        .executeTakeFirstOrThrow()
    ).sync_error_code,
  ).toBe('google_quota');
  await sync();
  await db
    .insertInto('google_meet_records')
    .values({
      tenant_id: tenant,
      connection_id: connection,
      space_id: space,
      resource_name: 'conferenceRecords/expired',
      starts_at: new Date(Date.now() - 200 * 86400000),
      ends_at: new Date(Date.now() - 199 * 86400000),
    })
    .execute();
  await scheduleMeetSync(db, async () => {});
  expect(
    await db
      .selectFrom('google_meet_records')
      .select('id')
      .where('resource_name', '=', 'conferenceRecords/expired')
      .where('connection_id', '=', connection)
      .executeTakeFirst(),
  ).toBeUndefined();
  withdrawDuringFetch = true;
  await runMeetSyncPage(db, env, rootJob(), async () => {});
  expect(
    await db
      .selectFrom('google_meet_records')
      .selectAll()
      .where('connection_id', '=', connection)
      .execute(),
  ).toHaveLength(0);
  const calls = requests.length;
  await sync();
  expect(requests).toHaveLength(calls);
  expect(
    await db.selectFrom('calendar_events').select('id').where('id', '=', event).executeTakeFirst(),
  ).toBeTruthy();
  expect((await call('GET', '/api/reports/meet/' + recordId)).statusCode).toBe(404);
  expect(
    await db
      .selectFrom('storage_logical_payloads')
      .selectAll()
      .where('tenant_id', '=', tenant)
      .where('relation_name', '=', 'google_meet_transcript_entries')
      .execute(),
  ).toHaveLength(0);
});
