import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDb, migrate, decryptSecret } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';
import { GOOGLE_MEET_SCOPE, GOOGLE_CALENDAR_SCOPE } from '../../src/modules/google/client.js';
const url = process.env.DATABASE_URL_TEST!,
  redis = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Exclusive test DB required');
const db = createDb(url),
  tenant = randomUUID(),
  user = randomUUID(),
  other = randomUUID(),
  key = randomBytes(32).toString('base64'),
  origin = 'http://localhost:5173',
  cookies = new Map<string, string>();
let grantCalendar = false,
  failMeeting = false,
  meetingFailureStatus = 403,
  meetCalls = 0,
  refreshCalls = 0;
const requests: { url: string; body: string }[] = [];
const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
  const url = String(input);
  requests.push({ url, body: String(init?.body ?? '') });
  if (url === 'https://oauth2.googleapis.com/token') {
    const body = new URLSearchParams(String(init?.body));
    if (body.get('grant_type') === 'refresh_token') refreshCalls++;
    return Response.json({
      access_token: 'access-local-only',
      refresh_token: 'refresh-local-only',
      expires_in: 3600,
      scope:
        'openid email ' + GOOGLE_MEET_SCOPE + (grantCalendar ? ' ' + GOOGLE_CALENDAR_SCOPE : ''),
    });
  }
  if (url === 'https://openidconnect.googleapis.com/v1/userinfo')
    return Response.json({
      sub: 'google-test-subject',
      email: 'owner@qa.example',
      email_verified: true,
    });
  if (url === 'https://meet.googleapis.com/v2/spaces') {
    meetCalls++;
    if (failMeeting && meetingFailureStatus === 0) throw new TypeError('network failure');
    return failMeeting
      ? Response.json(
          { error: 'provider diagnostic must not leak' },
          { status: meetingFailureStatus },
        )
      : Response.json({ name: 'spaces/local', meetingUri: 'https://meet.google.com/abc-defg-hij' });
  }
  if (url.startsWith('https://www.googleapis.com/calendar/v3/calendars/primary/events?'))
    return Response.json({
      items: [
        {
          id: 'external-1',
          summary: 'Agenda externa QA',
          start: { dateTime: '2030-10-15T10:00:00-03:00' },
          end: { dateTime: '2030-10-15T11:00:00-03:00' },
        },
      ],
    });
  if (url === 'https://oauth2.googleapis.com/revoke') return new Response('', { status: 200 });
  throw Error('External call not expected');
});
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redis,
    APP_URL: origin,
    SESSION_SECRET: key,
    CREDENTIALS_ENCRYPTION_KEY: key,
    STORAGE_DIR: join(tmpdir(), 'apmail-google-' + tenant),
    GOOGLE_CLIENT_ID: 'local-test-client',
    GOOGLE_CLIENT_SECRET: 'local-test-secret',
  }),
);
const call = (method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, actor = user) =>
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
async function connect(calendar = false) {
  grantCalendar = calendar;
  const response = await call('POST', '/api/integrations/google/connect', { calendar });
  expect(response.statusCode, response.body).toBe(200);
  const auth = new URL(response.json().url),
    state = auth.searchParams.get('state')!;
  return {
    auth,
    state,
    finish: () =>
      call('GET', '/api/integrations/google/callback?state=' + state + '&code=local-code'),
  };
}
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values({ id: tenant, name: 'Google QA', slug: 'google-' + tenant })
    .execute();
  for (const id of [user, other]) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@qa.example',
        full_name: 'Google QA',
        current_tenant_id: tenant,
        password_hash: 'not-a-login-fixture',
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tenant, user_id: id, role: 'owner' })
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
});
afterAll(async () => {
  fetchMock.mockRestore();
  await app.close();
  await db.destroy();
});
it('OAuth usa PKCE, estado de uso único e vinculação à sessão', async () => {
  const flow = await connect();
  expect(flow.auth.origin).toBe('https://accounts.google.com');
  expect(flow.auth.searchParams.get('code_challenge_method')).toBe('S256');
  expect(flow.auth.searchParams.get('access_type')).toBe('offline');
  expect(
    (
      await call(
        'GET',
        '/api/integrations/google/callback?state=' + flow.state + '&code=wrong',
        undefined,
        other,
      )
    ).statusCode,
  ).toBe(403);
  expect((await flow.finish()).statusCode).toBe(302);
  expect((await flow.finish()).statusCode).toBe(409);
  const status = (await call('GET', '/api/integrations/google')).json();
  expect(status).toMatchObject({
    connected: true,
    meet: true,
    calendar: false,
    email: 'owner@qa.example',
  });
  expect(JSON.stringify(status)).not.toMatch(/access-local|refresh-local|local-test-secret/);
  const stored = await db
    .selectFrom('google_connections')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .executeTakeFirstOrThrow();
  expect(stored.encrypted_tokens).not.toContain('refresh-local-only');
  expect(JSON.parse(decryptSecret(stored.encrypted_tokens, key)).refresh_token).toBe(
    'refresh-local-only',
  );
  expect((await call('GET', '/api/integrations/google', undefined, other)).json().connected).toBe(
    false,
  );
});
it('Meet usa a API real e uma chave idempotente sem repetir criação', async () => {
  const request_id = randomUUID(),
    before = meetCalls;
  const first = await call('POST', '/api/integrations/google/meet', { request_id });
  expect(first.statusCode, first.body).toBe(200);
  expect(first.json().meeting_url).toBe('https://meet.google.com/abc-defg-hij');
  expect((await call('POST', '/api/integrations/google/meet', { request_id })).statusCode).toBe(
    200,
  );
  expect(meetCalls).toBe(before + 1);
  expect(
    (await call('POST', '/api/integrations/google/meet', { request_id }, other)).statusCode,
  ).toBe(409);
});
it('renova tokens no servidor e não expõe falhas do provedor', async () => {
  await db
    .updateTable('google_connections')
    .set({ expires_at: new Date(0) })
    .where('tenant_id', '=', tenant)
    .execute();
  const before = refreshCalls;
  expect(
    (await call('POST', '/api/integrations/google/meet', { request_id: randomUUID() })).statusCode,
  ).toBe(200);
  expect(refreshCalls).toBe(before + 1);
  failMeeting = true;
  const request_id = randomUUID(),
    result = await call('POST', '/api/integrations/google/meet', { request_id });
  expect(result.statusCode).toBe(502);
  expect(result.body).not.toContain('provider diagnostic');
  expect((await call('POST', '/api/integrations/google/meet', { request_id })).statusCode).toBe(
    409,
  );
  failMeeting = false;
});
it.each([400, 403, 429])(
  'identifica rejeição definitiva %s sem permitir duplicar a solicitação',
  async (status) => {
    const request_id = randomUUID();
    failMeeting = true;
    meetingFailureStatus = status;
    const result = await call('POST', '/api/integrations/google/meet', { request_id });
    expect(result.json().error.code).toBe('google_meeting_rejected');
    expect(result.body).not.toContain('provider diagnostic');
    const saved = await db
      .selectFrom('google_meeting_requests')
      .select('status')
      .where('id', '=', request_id)
      .executeTakeFirstOrThrow();
    expect(saved.status).toBe('failed');
    failMeeting = false;
    const before = meetCalls;
    expect((await call('POST', '/api/integrations/google/meet', { request_id })).statusCode).toBe(
      409,
    );
    expect(meetCalls).toBe(before);
    expect(
      (await call('POST', '/api/integrations/google/meet', { request_id: randomUUID() }))
        .statusCode,
    ).toBe(200);
  },
);
it.each([0, 408, 500, 503, 504])(
  'preserva resultado incerto após falha %s na criação Meet',
  async (status) => {
    const request_id = randomUUID();
    failMeeting = true;
    meetingFailureStatus = status;
    const result = await call('POST', '/api/integrations/google/meet', { request_id });
    expect(result.statusCode).toBeGreaterThanOrEqual(500);
    expect(result.json().error.code).not.toBe('google_meeting_rejected');
    const saved = await db
      .selectFrom('google_meeting_requests')
      .select('status')
      .where('id', '=', request_id)
      .executeTakeFirstOrThrow();
    expect(saved.status).toBe('uncertain');
    failMeeting = false;
    const before = meetCalls;
    expect((await call('POST', '/api/integrations/google/meet', { request_id })).statusCode).toBe(
      409,
    );
    expect(meetCalls).toBe(before);
  },
);
it('Agenda exige consentimento opcional e consulta eventos sem prometer sincronização', async () => {
  expect((await call('GET', '/api/integrations/google/calendar/events')).statusCode).toBe(409);
  const flow = await connect(true);
  expect(flow.auth.searchParams.get('scope')).toContain(GOOGLE_CALENDAR_SCOPE);
  await flow.finish();
  expect((await call('GET', '/api/integrations/google/calendar/events')).json()[0].summary).toBe(
    'Agenda externa QA',
  );
  expect((await call('GET', '/api/integrations/google')).json().calendar).toBe(true);
});
it('cancelamento não conecta outra conta e desconexão revoga credenciais', async () => {
  const flow = await connect();
  const declined = await call(
    'GET',
    '/api/integrations/google/callback?state=' + flow.state + '&error=access_denied',
  );
  expect(declined.statusCode).toBe(302);
  expect(declined.headers.location).toContain('cancelled');
  expect((await call('DELETE', '/api/integrations/google')).statusCode).toBe(200);
  expect((await call('GET', '/api/integrations/google')).json().connected).toBe(false);
  expect(requests.some((r) => r.url.endsWith('/revoke'))).toBe(true);
});
