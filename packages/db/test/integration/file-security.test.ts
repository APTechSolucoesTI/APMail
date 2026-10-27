import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDb } from '../../src/client.js';
import { migrate } from '../../src/migrate.js';
import { Storage } from '../../src/storage.js';
import { scanClamAv } from '../../src/security/clamav.js';
import {
  registerSecurityFile,
  assertFilesClean,
  requestFileRescan,
  securityForFiles,
} from '../../src/security/files.js';
import { scanSecurityFile } from '../../src/security/processor.js';
vi.mock('../../src/security/clamav.js', () => ({ scanClamAv: vi.fn(), probeClamAv: vi.fn() }));
const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Dedicated test database required');
const db = createDb(url),
  tenant = randomUUID(),
  box = randomUUID();
const storage = new Storage(join(tmpdir(), 'apmail-av-' + tenant));
const options = {
  host: '127.0.0.1',
  port: 3310,
  maxBytes: 26214400,
  timeoutMs: 1000,
  connectTimeoutMs: 1000,
  definitionsMaxAgeHours: 168,
};
const content = Buffer.from('A safe local test attachment');
const verdict = (status: 'clean' | 'infected' | 'error') => ({
  status,
  sha256: createHash('sha256').update(content).digest('hex'),
  size_bytes: content.length,
  threat_name: status === 'infected' ? 'Eicar-Signature' : null,
  error_code: status === 'error' ? 'connection_failed' : null,
  engine_version: '1.5.4',
  signature_version: '28164',
  definitions_at: new Date().toISOString(),
  duration_ms: 5,
});
async function file(messageId?: string) {
  const id = randomUUID(),
    path = `uploads/${tenant}/${box}/${id}`;
  await storage.writeFile(path, content);
  return registerSecurityFile(db, {
    storage_key: path,
    tenant_id: tenant,
    mailbox_id: box,
    filename: 'test.txt',
    content_type: 'text/plain',
    size_bytes: content.length,
    kind: messageId ? 'attachment' : 'upload',
    message_id: messageId ?? null,
  });
}
beforeAll(async () => {
  await migrate(url);
  await db.insertInto('tenants').values({ id: tenant, name: 'AV test', slug: tenant }).execute();
  await db
    .insertInto('mailboxes')
    .values({
      id: box,
      tenant_id: tenant,
      name: 'QA',
      email_address: box + '@qa.local',
      username: 'qa',
      imap_host: 'localhost',
      smtp_host: 'localhost',
    })
    .execute();
}, 120000);
afterAll(async () => {
  await db.destroy();
});
it('blocks unverified legacy and newly registered files, persists a clean result and scans once', async () => {
  await expect(assertFilesClean(db, ['missing-file'])).rejects.toMatchObject({
    code: 'file_pending',
  });
  const row = await file();
  await expect(assertFilesClean(db, [row.storage_key])).rejects.toMatchObject({
    code: 'file_pending',
  });
  vi.mocked(scanClamAv).mockResolvedValue(verdict('clean'));
  await scanSecurityFile(db, storage, row.id, options);
  await assertFilesClean(db, [row.storage_key], storage);
  await scanSecurityFile(db, storage, row.id, options);
  expect(scanClamAv).toHaveBeenCalledTimes(1);
  expect(
    await db.selectFrom('file_scan_history').select('id').where('file_id', '=', row.id).execute(),
  ).toHaveLength(1);
});
it('quarantines detections without deleting bytes and keeps failed analysis blocked', async () => {
  for (const status of ['infected', 'error'] as const) {
    const row = await file();
    vi.mocked(scanClamAv).mockResolvedValue(verdict(status));
    await scanSecurityFile(db, storage, row.id, options);
    await expect(assertFilesClean(db, [row.storage_key])).rejects.toMatchObject({
      code: status === 'infected' ? 'file_infected' : 'file_scan_error',
    });
    expect(await storage.inspect(row.storage_key)).not.toBeNull();
  }
});
it('discards an obsolete verdict after a concurrent rescan request', async () => {
  const row = await file();
  vi.mocked(scanClamAv).mockImplementationOnce(async () => {
    await requestFileRescan(db, row.id, tenant);
    return verdict('clean');
  });
  await scanSecurityFile(db, storage, row.id, options);
  expect(
    await db
      .selectFrom('file_security')
      .select(['status', 'generation'])
      .where('id', '=', row.id)
      .executeTakeFirst(),
  ).toEqual({ status: 'pending', generation: 2 });
  await expect(assertFilesClean(db, [row.storage_key])).rejects.toMatchObject({
    code: 'file_pending',
  });
});
it('refuses cached clean evidence when bytes were modified outside the database transaction', async () => {
  const row = await file();
  vi.mocked(scanClamAv).mockResolvedValue(verdict('clean'));
  await scanSecurityFile(db, storage, row.id, options);
  await storage.writeFile(row.storage_key, Buffer.from('Different bytes'));
  await expect(assertFilesClean(db, [row.storage_key], storage)).rejects.toMatchObject({
    code: 'file_pending',
  });
});
it('automatically releases only matching protected invoices after a real scan and keeps the raw detection', async () => {
  const thread = randomUUID(),
    message = randomUUID();
  await db
    .insertInto('threads')
    .values({ id: thread, tenant_id: tenant, mailbox_id: box, subject: 'Recurring invoice' })
    .execute();
  await db
    .insertInto('messages')
    .values({
      id: message,
      tenant_id: tenant,
      mailbox_id: box,
      thread_id: thread,
      from_address: 'billing@qa.example',
      message_id_header: `<${message}@qa.example>`,
      message_at: new Date(),
      subject: 'Invoice',
      direction: 'inbound',
      raw_storage_path: 'qa/raw-' + message,
      size_bytes: content.length,
    })
    .execute();
  await db
    .insertInto('antivirus_sender_rules')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      sender: 'billing@qa.example',
      policy: 'encrypted',
    })
    .execute();
  const invoice = await file(message);
  vi.mocked(scanClamAv).mockResolvedValue({
    ...verdict('infected'),
    threat_name: 'Heuristics.Encrypted.PDF',
  });
  await scanSecurityFile(db, storage, invoice.id, options);
  await assertFilesClean(db, [invoice.storage_key], storage);
  expect(
    (await securityForFiles(db, [invoice.storage_key])).get(invoice.storage_key),
  ).toMatchObject({
    status: 'infected',
    threat_name: 'Heuristics.Encrypted.PDF',
    release_kind: 'sender',
    access_allowed: true,
  });
  const malware = await file(message);
  vi.mocked(scanClamAv).mockResolvedValue(verdict('infected'));
  await scanSecurityFile(db, storage, malware.id, options);
  await expect(assertFilesClean(db, [malware.storage_key])).rejects.toMatchObject({
    code: 'file_infected',
  });
  const limited = await file(message);
  vi.mocked(scanClamAv).mockResolvedValue({
    ...verdict('infected'),
    threat_name: 'Heuristics.Limits.Exceeded.MaxScanSize',
  });
  await scanSecurityFile(db, storage, limited.id, options);
  await expect(assertFilesClean(db, [limited.storage_key])).rejects.toMatchObject({
    code: 'file_infected',
  });
  await db
    .updateTable('messages')
    .set({ from_address: 'someone-else@qa.example' })
    .where('id', '=', message)
    .execute();
  await expect(assertFilesClean(db, [invoice.storage_key])).rejects.toMatchObject({
    code: 'file_infected',
  });
});
