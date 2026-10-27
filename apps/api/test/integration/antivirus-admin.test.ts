import { beforeAll, afterAll, beforeEach, expect, it, vi } from 'vitest';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { sql } from 'kysely';
import { Server } from 'socket.io';
import {
  createDb,
  createQueues,
  migrate,
  registerSecurityFile,
  refreshAntivirusHealth,
  countUnverifiedFiles,
  Storage,
  assertFilesClean,
  applySenderTrust,
  securityForFiles,
} from '@apmail/db';
import { ZodError } from 'zod';
import { registerAntivirus } from '../../src/modules/antivirus.js';
import { envSchema } from '../../src/env.js';
import { ApiError } from '../../src/authz/context.js';
vi.mock('@apmail/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@apmail/db')>()),
  refreshAntivirusHealth: vi.fn(),
}));
const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Private antivirus admin database required');
const db = createDb(url),
  queueResources = createQueues(process.env.REDIS_URL_TEST!);
const app = Fastify();
const tenant = randomUUID(),
  otherTenant = randomUUID(),
  owner = randomUUID(),
  otherOwner = randomUUID(),
  mailbox = randomUUID(),
  thread = randomUUID(),
  message = randomUUID(),
  cleanAttachment = randomUUID(),
  badAttachment = randomUUID();
const secret = randomBytes(32).toString('base64');
const env = envSchema.parse({
  NODE_ENV: 'test',
  DATABASE_URL: url,
  REDIS_URL: process.env.REDIS_URL_TEST,
  APP_URL: 'http://localhost:5173',
  SESSION_SECRET: secret,
  CREDENTIALS_ENCRYPTION_KEY: secret,
  STORAGE_DIR: join(tmpdir(), 'apmail-trust-' + tenant),
});
let role: 'owner' | 'admin' | 'member' | 'supervisor' = 'owner',
  authenticated = true;
let cleanFile: string, badFile: string, foreignFile: string;
const prefix = 'qa-av-' + randomUUID();
app.addHook('onRequest', async (req) => {
  req.ctx = authenticated
    ? {
        userId: owner,
        tenantId: tenant,
        tenantRole: role,
        requestId: randomUUID(),
        ip: '127.0.0.1',
        sessionHash: 'test',
        mailboxRoles: new Map(),
        capabilities: ['members', 'audit'],
        accessRestricted: role === 'member',
        accessProfileId: role === 'member' ? randomUUID() : null,
        accessPermissions: [
          'mail',
          'users.view',
          'users.manage',
          'profiles.manage',
          'audit.view',
          'company.manage',
        ],
      }
    : null;
});
app.setErrorHandler((error, _req, reply) => {
  if (error instanceof ZodError)
    return reply.code(400).send({ error: { code: 'validation_error' } });
  if (error instanceof ApiError)
    return reply
      .code(error.statusCode)
      .send({ error: { code: error.code, message: error.message } });
  return reply.code(500).send({
    error: { code: 'internal', message: error instanceof Error ? error.message : 'failed' },
  });
});
const call = (method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown) =>
  app.inject({
    method,
    url: '/api/security/antivirus' + path,
    ...(body === undefined
      ? {}
      : { payload: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
  });
async function attachment(id: string, filename: string, inline = false) {
  await db
    .insertInto('attachments')
    .values({
      id,
      tenant_id: tenant,
      mailbox_id: mailbox,
      message_id: message,
      filename,
      content_type: 'application/pdf',
      storage_path: `${prefix}/${id}`,
      size_bytes: 50,
      is_inline: inline,
      content_id: inline ? 'logo' : null,
    })
    .execute();
}
async function file(name: string, status: 'pending' | 'infected' | 'error', target = tenant) {
  return registerSecurityFile(db, {
    tenant_id: target,
    mailbox_id: target === tenant ? mailbox : null,
    kind: 'upload',
    resource_id: randomUUID(),
    storage_key: `${prefix}/${name}`,
    filename: name,
    content_type: 'application/octet-stream',
    size_bytes: 12,
  }).then(async (row) => {
    await db.updateTable('file_security').set({ status }).where('id', '=', row.id).execute();
    return row.id;
  });
}
beforeAll(async () => {
  await migrate(url);
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Antivirus QA', slug: prefix },
      { id: otherTenant, name: 'Other QA', slug: prefix + '-other' },
    ])
    .execute();
  await db
    .insertInto('users')
    .values([
      {
        id: owner,
        email: `${owner}@qa.example`,
        full_name: 'Admin QA',
        password_hash: 'test',
        avatar_path: `${prefix}/avatar.webp`,
      },
      {
        id: otherOwner,
        email: `${otherOwner}@qa.example`,
        full_name: 'Other QA',
        password_hash: 'test',
        avatar_path: `${prefix}/other-avatar.webp`,
      },
    ])
    .execute();
  await db
    .insertInto('tenant_members')
    .values([
      { tenant_id: tenant, user_id: owner, role: 'owner' },
      { tenant_id: otherTenant, user_id: otherOwner, role: 'owner' },
    ])
    .execute();
  await db
    .insertInto('mailboxes')
    .values({
      id: mailbox,
      tenant_id: tenant,
      name: 'Financeiro',
      email_address: 'financeiro@qa.example',
      imap_host: 'localhost',
      smtp_host: 'localhost',
      username: 'qa',
    })
    .execute();
  await db
    .insertInto('threads')
    .values({
      id: thread,
      tenant_id: tenant,
      mailbox_id: mailbox,
      subject: 'Contrato confidencial',
    })
    .execute();
  await db
    .insertInto('messages')
    .values({
      id: message,
      tenant_id: tenant,
      mailbox_id: mailbox,
      thread_id: thread,
      direction: 'inbound',
      message_at: new Date(),
      message_id_header: `<${message}@qa.example>`,
      subject: 'Contrato confidencial',
      raw_storage_path: `${prefix}/raw.eml`,
      size_bytes: 50,
    })
    .execute();
  await attachment(cleanAttachment, 'documento.pdf');
  await attachment(badAttachment, 'virus.exe');
  await attachment(randomUUID(), 'logo.png', true);
  const clean = await registerSecurityFile(db, {
    tenant_id: tenant,
    mailbox_id: mailbox,
    message_id: message,
    resource_id: cleanAttachment,
    storage_key: `${prefix}/${cleanAttachment}`,
    filename: 'documento.pdf',
    content_type: 'application/pdf',
    size_bytes: 50,
    kind: 'attachment',
  });
  cleanFile = clean.id;
  await db
    .updateTable('file_security')
    .set({ status: 'clean', sha256: 'a'.repeat(64), scanned_at: new Date() })
    .where('id', '=', cleanFile)
    .execute();
  const bad = await registerSecurityFile(db, {
    tenant_id: tenant,
    mailbox_id: mailbox,
    message_id: message,
    resource_id: badAttachment,
    storage_key: `${prefix}/${badAttachment}`,
    filename: 'virus.exe',
    content_type: 'application/octet-stream',
    size_bytes: 50,
    kind: 'attachment',
  });
  badFile = bad.id;
  await db
    .updateTable('file_security')
    .set({ status: 'infected', threat_name: 'Win.QA', scanned_at: new Date() })
    .where('id', '=', badFile)
    .execute();
  foreignFile = await file('foreign.bin', 'infected', otherTenant);
  await db
    .insertInto('uploads')
    .values([
      {
        id: randomUUID(),
        tenant_id: tenant,
        mailbox_id: mailbox,
        user_id: owner,
        filename: 'novo.txt',
        content_type: 'text/plain',
        size_bytes: 10,
        storage_path: `${prefix}/upload`,
      },
      {
        id: randomUUID(),
        tenant_id: tenant,
        mailbox_id: mailbox,
        user_id: owner,
        filename: 'consumido.txt',
        content_type: 'text/plain',
        size_bytes: 10,
        storage_path: `${prefix}/consumed`,
        consumed_at: new Date(),
      },
    ])
    .execute();
  await db
    .insertInto('signature_images')
    .values({
      id: randomUUID(),
      tenant_id: tenant,
      user_id: owner,
      storage_path: `${prefix}/signature.png`,
      content_type: 'image/png',
      size_bytes: 10,
      width: 1,
      height: 1,
    })
    .execute();
  await db
    .insertInto('mail_archive_imports')
    .values([
      {
        id: randomUUID(),
        tenant_id: tenant,
        mailbox_id: mailbox,
        created_by: owner,
        filename: 'backup.pst',
        format: 'pst',
        size_bytes: '20',
        uploaded_bytes: '20',
        state: 'completed',
        storage_path: `${prefix}/import.pst`,
      },
      {
        id: randomUUID(),
        tenant_id: tenant,
        mailbox_id: mailbox,
        created_by: owner,
        filename: 'partial.pst',
        format: 'pst',
        size_bytes: '20',
        uploaded_bytes: '10',
        state: 'uploading',
        storage_path: `${prefix}/partial.pst`,
      },
    ])
    .execute();
  const exportId = randomUUID();
  await db
    .insertInto('mail_archive_exports')
    .values({
      id: exportId,
      tenant_id: tenant,
      mailbox_id: mailbox,
      created_by: owner,
      filename: 'saida.pst',
      format: 'pst',
      state: 'ready',
    })
    .execute();
  await db
    .insertInto('mail_archive_export_files')
    .values({
      id: randomUUID(),
      export_id: exportId,
      tenant_id: tenant,
      mailbox_id: mailbox,
      filename: 'saida.pst',
      kind: 'pst',
      storage_path: `${prefix}/export.pst`,
      size_bytes: '20',
    })
    .execute();
  await db
    .insertInto('file_scan_history')
    .values({
      file_id: badFile,
      tenant_id: tenant,
      mailbox_id: mailbox,
      message_id: message,
      filename: 'virus.exe',
      kind: 'attachment',
      content_type: 'application/octet-stream',
      size_bytes: '50',
      generation: 1,
      attempt: 1,
      status: 'infected',
      threat_name: 'Win.QA',
    })
    .execute();
  await registerAntivirus(app, {
    db,
    redis: queueResources.connection,
    io: new Server(),
    queues: queueResources.queues,
    env,
  });
  await app.ready();
}, 30000);
beforeEach(() => {
  authenticated = true;
  role = 'owner';
  vi.mocked(refreshAntivirusHealth).mockResolvedValue({
    id: 1,
    status: 'online',
    engine_version: 'ClamAV QA',
    signature_version: '123',
    definitions_at: new Date(),
    checked_at: new Date(),
    error_code: null,
    last_alert_at: null,
    alert_key: null,
  });
});
afterAll(async () => {
  await app.close();
  await queueResources.close();
  await db.destroy();
});
it('requires authenticated owner/admin even with delegated broad permissions', async () => {
  authenticated = false;
  expect((await call('GET', '/overview')).statusCode).toBe(401);
  authenticated = true;
  for (const denied of ['member', 'supervisor'] as const) {
    role = denied;
    for (const path of ['/overview', '/files', '/history'])
      expect((await call('GET', path)).statusCode).toBe(403);
    expect((await call('POST', '/backfill', { limit: 10, scope: 'unverified' })).statusCode).toBe(
      403,
    );
    expect((await call('POST', `/files/${badFile}/rescan`, {})).statusCode).toBe(403);
  }
});
it('includes legacy candidates in pending counts without registering or queueing on GET', async () => {
  const waitingBefore = await queueResources.queues['antivirus-scan'].getWaitingCount();
  const before = await db
    .selectFrom('file_security')
    .select(sql<number>`count(*)::int`.as('n'))
    .executeTakeFirstOrThrow();
  expect(await countUnverifiedFiles(db, tenant)).toBe(7);
  const response = await call('GET', '/overview');
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().counts).toMatchObject({
    total: 9,
    pending: 7,
    clean: 1,
    infected: 1,
    error: 0,
    unverified: 7,
  });
  await call('GET', '/files');
  await call('GET', '/history');
  const after = await db
    .selectFrom('file_security')
    .select(sql<number>`count(*)::int`.as('n'))
    .executeTakeFirstOrThrow();
  expect(after.n).toBe(before.n);
  expect(await queueResources.queues['antivirus-scan'].getWaitingCount()).toBe(waitingBefore);
});
it('filters and pages legacy/registered metadata without paths or file bodies', async () => {
  const response = await call('GET', '/files?status=pending&page=1&page_size=10');
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().total).toBe(7);
  expect(response.json().items).toHaveLength(7);
  const searched = await call('GET', '/files?search=documento&status=clean&page=1&page_size=10');
  expect(searched.json().total).toBe(1);
  expect(searched.json().items[0]).toMatchObject({
    id: cleanFile,
    filename: 'documento.pdf',
    status: 'clean',
    message: { id: message, thread_id: thread, subject: 'Contrato confidencial' },
    mailbox: { id: mailbox, name: 'Financeiro' },
  });
  expect(searched.body).not.toContain('storage_key');
  expect(searched.body).not.toContain(prefix);
  expect(searched.body).not.toContain('sha256');
  expect(searched.body).not.toContain('body_text');
  expect((await call('GET', '/files?status=garbage')).statusCode).toBe(400);
  expect((await call('GET', '/files?page_size=5000')).statusCode).toBe(400);
});
it('preserves scan history and ignores cross-tenant rescan IDs', async () => {
  expect((await call('POST', `/files/${foreignFile}/rescan`, {})).statusCode).toBe(404);
  const history = await call('GET', '/history?search=virus');
  expect(history.statusCode, history.body).toBe(200);
  expect(history.json().items[0]).toMatchObject({ file_id: badFile, status: 'infected' });
  const response = await call('POST', `/files/${badFile}/rescan`, {});
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json()).toMatchObject({ id: badFile, status: 'pending' });
  const current = await db
    .selectFrom('file_security')
    .selectAll()
    .where('id', '=', badFile)
    .executeTakeFirstOrThrow();
  expect(current.generation).toBe(2);
  expect(current.status).toBe('pending');
  expect((await call('GET', '/history?search=virus')).json().total).toBe(1);
  const audit = await db
    .selectFrom('audit_logs')
    .select('metadata')
    .where('tenant_id', '=', tenant)
    .where('action', '=', 'security.file_rescan_requested')
    .executeTakeFirstOrThrow();
  expect(JSON.stringify(audit.metadata)).toContain(badFile);
  expect(JSON.stringify(audit.metadata)).not.toContain(prefix);
});
it('does not reset a file with an active worker lease', async () => {
  await db
    .updateTable('file_security')
    .set({ lease_token: randomUUID(), lease_expires_at: new Date(Date.now() + 60000) })
    .where('id', '=', cleanFile)
    .execute();
  const response = await call('POST', `/files/${cleanFile}/rescan`, {});
  expect(response.statusCode, response.body).toBe(409);
  expect(
    (
      await db
        .selectFrom('file_security')
        .select('status')
        .where('id', '=', cleanFile)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('clean');
});
it('backfills only bounded tenant candidates and keeps pending rows if queue publication fails', async () => {
  const publish = vi
    .spyOn(queueResources.queues['antivirus-scan'], 'add')
    .mockRejectedValueOnce(new Error('offline'));
  const response = await call('POST', '/backfill', { limit: 10, scope: 'unverified' });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().queued).toBe(7);
  publish.mockRestore();
  expect(await countUnverifiedFiles(db, tenant)).toBe(0);
  const rows = await db
    .selectFrom('file_security')
    .select(['status', 'storage_key'])
    .where('storage_key', 'like', prefix + '/%')
    .execute();
  expect(rows.some((row) => row.storage_key.endsWith('/partial.pst'))).toBe(false);
  expect(rows.some((row) => row.storage_key.endsWith('/consumed'))).toBe(false);
  expect(rows.some((row) => row.storage_key.endsWith('/other-avatar.webp'))).toBe(false);
  expect((await call('POST', '/backfill', { limit: 1000, scope: 'unverified' })).statusCode).toBe(
    400,
  );
});
it('retries failed files only for this tenant and skips active leases', async () => {
  const eligible = await file('eligible.bin', 'error'),
    leased = await file('leased.bin', 'error'),
    foreign = await file('foreign-error.bin', 'error', otherTenant);
  await db
    .updateTable('file_security')
    .set({ lease_token: randomUUID(), lease_expires_at: new Date(Date.now() + 60000) })
    .where('id', '=', leased)
    .execute();
  const response = await call('POST', '/backfill', { limit: 10, scope: 'failed' });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().queued).toBe(1);
  for (const [id, status] of [
    [eligible, 'pending'],
    [leased, 'error'],
    [foreign, 'error'],
  ])
    expect(
      (
        await db
          .selectFrom('file_security')
          .select('status')
          .where('id', '=', id!)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe(status);
});

async function blockedFile(threat = 'Heuristics.Encrypted.PDF') {
  const id = randomUUID(),
    storage = new Storage(env.STORAGE_DIR),
    data = Buffer.from('Synthetic invoice ' + id),
    path = prefix + '/' + id;
  await storage.writeFile(path, data);
  const file = await registerSecurityFile(db, {
    tenant_id: tenant,
    mailbox_id: mailbox,
    message_id: message,
    resource_id: id,
    kind: 'attachment',
    storage_key: path,
    filename: 'fatura-' + id + '.pdf',
    content_type: 'application/pdf',
    size_bytes: data.length,
  });
  return db
    .updateTable('file_security')
    .set({
      status: 'infected',
      threat_name: threat,
      sha256: createHash('sha256').update(data).digest('hex'),
      scanned_at: new Date(),
    })
    .where('id', '=', file.id)
    .returningAll()
    .executeTakeFirstOrThrow();
}
it('requires admin permission and explicit consent, releases a batch atomically and records revocation', async () => {
  const a = await blockedFile(),
    b = await blockedFile();
  const input = {
    file_ids: [a.id, b.id],
    reason: 'Faturas conhecidas e conferidas pelo administrador.',
    false_positive: true,
    acknowledge_risk: true,
  };
  role = 'member';
  expect((await call('POST', '/releases', input)).statusCode).toBe(403);
  expect((await call('GET', '/rules')).statusCode).toBe(403);
  role = 'owner';
  expect((await call('POST', '/releases', { ...input, acknowledge_risk: false })).statusCode).toBe(
    400,
  );
  expect(
    (await call('POST', '/releases', { ...input, file_ids: [a.id, foreignFile] })).statusCode,
  ).toBe(404);
  expect((await securityForFiles(db, [a.storage_key])).get(a.storage_key)?.access_allowed).toBe(
    false,
  );
  const released = await call('POST', '/releases', input);
  expect(released.statusCode, released.body).toBe(200);
  await assertFilesClean(db, [a.storage_key, b.storage_key], new Storage(env.STORAGE_DIR));
  const current = await db
    .selectFrom('file_security')
    .selectAll()
    .where('id', '=', a.id)
    .executeTakeFirstOrThrow();
  expect(current).toMatchObject({
    status: 'infected',
    threat_name: 'Heuristics.Encrypted.PDF',
    false_positive: true,
    release_kind: 'manual',
  });
  expect(
    (await call('GET', '/files?status=released'))
      .json()
      .items.some(
        (f: { id: string; access_allowed: boolean }) => f.id === a.id && f.access_allowed,
      ),
  ).toBe(true);
  const decisions = await call('GET', '/decisions?file_id=' + a.id);
  expect(decisions.statusCode, decisions.body).toBe(200);
  expect(decisions.json().items[0]).toMatchObject({
    action: 'release',
    actor_id: owner,
    false_positive: true,
  });
  expect(
    (
      await call('POST', '/releases/revoke', {
        file_ids: [a.id],
        reason: 'Revisão da confiança na origem do arquivo.',
      })
    ).statusCode,
  ).toBe(200);
  await expect(assertFilesClean(db, [a.storage_key])).rejects.toMatchObject({
    code: 'file_infected',
  });
  await new Storage(env.STORAGE_DIR).writeFile(b.storage_key, Buffer.from('changed'));
  await expect(
    assertFilesClean(db, [b.storage_key], new Storage(env.STORAGE_DIR)),
  ).rejects.toMatchObject({ code: 'file_pending' });
});
it('requires additional confirmation for malware and rolls back the entire mixed batch', async () => {
  const safe = await blockedFile(),
    malware = await blockedFile('Eicar-Signature');
  const body = {
    file_ids: [safe.id, malware.id],
    reason: 'Análise independente e autorização expressa.',
    acknowledge_risk: true,
  };
  expect((await call('POST', '/releases', body)).statusCode).toBe(409);
  expect(
    (await securityForFiles(db, [safe.storage_key])).get(safe.storage_key)?.access_allowed,
  ).toBe(false);
  expect((await call('POST', '/releases', { ...body, acknowledge_malware: true })).statusCode).toBe(
    200,
  );
});
it('trusts only the exact sender and allowed heuristic, stops immediately on expiration or disabling', async () => {
  await db
    .updateTable('messages')
    .set({ from_address: 'faturas@fornecedor.example', direction: 'inbound' })
    .where('id', '=', message)
    .execute();
  const row = await blockedFile(),
    malware = await blockedFile('Trojan.Encrypted.PDF');
  const msg = await db
    .selectFrom('messages')
    .select('from_address')
    .where('id', '=', message)
    .executeTakeFirstOrThrow();
  const input = {
    sender: msg.from_address,
    mailbox_id: mailbox,
    policy: 'encrypted',
    notes: 'Faturas recorrentes com senha.',
  };
  expect((await call('POST', '/rules', { ...input, mailbox_id: randomUUID() })).statusCode).toBe(
    404,
  );
  const created = await call('POST', '/rules', input);
  expect(created.statusCode, created.body).toBe(200);
  const rule = created.json();
  await db.transaction().execute(async (tx) => {
    await applySenderTrust(tx, row);
    await applySenderTrust(tx, malware);
  });
  await assertFilesClean(db, [row.storage_key], new Storage(env.STORAGE_DIR));
  await expect(assertFilesClean(db, [malware.storage_key])).rejects.toMatchObject({
    code: 'file_infected',
  });
  await db
    .updateTable('antivirus_sender_rules')
    .set({ expires_at: new Date(Date.now() - 1000) })
    .where('id', '=', rule.id)
    .execute();
  await expect(assertFilesClean(db, [row.storage_key])).rejects.toMatchObject({
    code: 'file_infected',
  });
  const updated = await call('PATCH', '/rules/' + rule.id, { ...input, enabled: false });
  expect(updated.statusCode, updated.body).toBe(200);
  expect((await call('POST', '/rules/' + rule.id + '/apply', {})).statusCode).toBe(409);
  expect(
    (await call('PATCH', '/rules/' + randomUUID(), { ...input, enabled: true })).statusCode,
  ).toBe(404);
  expect((await call('PATCH', '/rules/' + rule.id, { ...input, enabled: true })).statusCode).toBe(
    200,
  );
  const existing = await call('POST', '/rules/' + rule.id + '/apply', {});
  expect(existing.statusCode, existing.body).toBe(200);
  expect(existing.json().released).toBeGreaterThan(0);
  await assertFilesClean(db, [row.storage_key], new Storage(env.STORAGE_DIR));
  expect((await call('PATCH', '/rules/' + rule.id, { ...input, enabled: false })).statusCode).toBe(
    200,
  );
  await expect(assertFilesClean(db, [row.storage_key])).rejects.toMatchObject({
    code: 'file_infected',
  });
});
