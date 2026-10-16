import { it, expect } from 'vitest';
import { nextMeetSyncAt } from './sync.js';
import { GoogleApiError, googleFailure, GoogleClient } from './client.js';
it('backs off old spaces while polling recently active meetings', () => {
  const now = new Date('2026-10-16T12:00:00Z'),
    before = new Date('2026-10-15T12:00:00Z');
  expect(+nextMeetSyncAt([], before, before, now) - +now).toBe(300000);
  expect(+nextMeetSyncAt([], new Date('2026-10-01'), before, now) - +now).toBe(3600000);
  expect(+nextMeetSyncAt([], new Date('2026-01-01'), before, now) - +now).toBe(86400000);
  const future = [
    { starts_at: new Date(+now + 30 * 60000), ends_at: new Date(+now + 3600000), rrule: null },
  ];
  expect(+nextMeetSyncAt(future, null, before, now) - +now).toBe(15 * 60000);
});
it('distinguishes OAuth, quota, expiry and configuration without guessing plans', async () => {
  expect(googleFailure(new GoogleApiError(401, 'invalid_grant')).state).toBe('permission_required');
  expect(googleFailure(new GoogleApiError(429, 'RATE_LIMIT_EXCEEDED')).state).toBe('quota_limited');
  expect(googleFailure(new GoogleApiError(404, 'provider_denied')).state).toBe(
    'not_found_or_expired',
  );
  expect(googleFailure(new GoogleApiError(403, 'SERVICE_DISABLED')).state).toBe(
    'configuration_pending',
  );
  const google = new GoogleClient(async () =>
    Response.json(
      {
        error: {
          message: 'secret diagnostic',
          details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      },
      { status: 403 },
    ),
  );
  await expect(google.meet('private-token', 'conferenceRecords')).rejects.toThrow('Reautorize');
  await expect(google.meet('private-token', '../oauth')).rejects.toThrow('invalid_google_resource');
});
