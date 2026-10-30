import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb } from '../../src/client.js';
import { migrate } from '../../src/migrate.js';
import { registerSecurityFile, securityForFiles } from '../../src/security/files.js';
import { probeClamAv } from '../../src/security/clamav.js';
import { refreshAntivirusHealth } from '../../src/security/processor.js';

vi.mock('../../src/security/clamav.js', () => ({ probeClamAv: vi.fn(), scanClamAv: vi.fn() }));
const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Dedicated test database required');
const db = createDb(url),
  tenant = randomUUID();
const options = {
  host: '127.0.0.1',
  port: 3310,
  maxBytes: 26214400,
  timeoutMs: 1000,
  connectTimeoutMs: 1000,
  definitionsMaxAgeHours: 168,
};
beforeAll(async () => {
  await migrate(url);
  await db
    .insertInto('tenants')
    .values({ id: tenant, name: 'AV recovery QA', slug: tenant })
    .execute();
}, 120000);
afterAll(async () => {
  await db.deleteFrom('tenants').where('id', '=', tenant).execute();
  await db.destroy();
});

it('antecipa somente falhas transitórias sem liberar arquivos após recuperação do motor', async () => {
  const future = new Date(Date.now() + 21600000);
  const fixtures = [
    { status: 'error', error_code: 'connection_failed', recover: true },
    { status: 'error', error_code: 'connect_timeout', recover: true },
    { status: 'error', error_code: 'timeout', recover: true },
    { status: 'error', error_code: 'size_limit', recover: false },
    { status: 'error', error_code: 'source_error', recover: false },
    { status: 'infected', error_code: null, recover: false },
    { status: 'error', error_code: 'connection_failed', recover: false, leased: true },
  ];
  const rows = [];
  for (const fixture of fixtures) {
    const file = await registerSecurityFile(db, {
      tenant_id: tenant,
      mailbox_id: null,
      storage_key: `uploads/${tenant}/${randomUUID()}`,
      kind: 'upload',
      filename: 'qa.txt',
      content_type: 'text/plain',
      size_bytes: 10,
    });
    await db
      .updateTable('file_security')
      .set({
        status: fixture.status,
        error_code: fixture.error_code,
        next_attempt_at: future,
        ...(fixture.leased ? { lease_token: randomUUID(), lease_expires_at: future } : {}),
      })
      .where('id', '=', file.id)
      .execute();
    rows.push({ ...fixture, file });
  }
  await db
    .insertInto('antivirus_health')
    .values({ id: 1, status: 'offline', checked_at: new Date(0) })
    .onConflict((oc) => oc.column('id').doUpdateSet({ status: 'offline', checked_at: new Date(0) }))
    .execute();
  vi.mocked(probeClamAv).mockResolvedValue({
    status: 'online',
    engine_version: '1.5.4',
    signature_version: '28169',
    definitions_at: new Date().toISOString(),
    checked_at: new Date().toISOString(),
    error_code: null,
  });

  await refreshAntivirusHealth(db, options);

  for (const row of rows) {
    const actual = await db
      .selectFrom('file_security')
      .selectAll()
      .where('id', '=', row.file.id)
      .executeTakeFirstOrThrow();
    expect(actual.status).toBe(row.status);
    expect(actual.next_attempt_at.getTime() < future.getTime()).toBe(row.recover);
    expect(
      (await securityForFiles(db, [row.file.storage_key])).get(row.file.storage_key)
        ?.access_allowed,
    ).toBe(false);
  }
});
