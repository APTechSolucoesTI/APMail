import { it, expect } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, link, symlink, truncate, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { createDb } from '../../src/client.js';
import { migrate } from '../../src/migrate.js';
import { Storage } from '../../src/storage.js';
import {
  reconcileStorage,
  requestStorageScan,
  refreshDiscrepancies,
} from '../../src/metering-scan.js';
import { publishStorageUsage } from '../../src/metering-snapshot.js';
import { observeStorageFile, refreshStorageOwnership } from '../../src/metering-files.js';

it('reconcilia com retomada, deduplica hardlinks, preserva medições em falha e identifica ausentes sem abrir conteúdo', async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw Error('Banco de teste exclusivo obrigatório.');
  await migrate(url);
  const db = createDb(url),
    root = await mkdtemp(join(tmpdir(), 'apmail-metering-'));
  const tenant = randomUUID(),
    box = randomUUID(),
    otherBox = randomUUID(),
    user = randomUUID(),
    thread = randomUUID(),
    message = randomUUID();
  const key = `attachments/${tenant}/${box}/${message}/${randomUUID()}`,
    hardlink = `attachments/${tenant}/${otherBox}/${message}/${randomUUID()}`,
    sparse = `attachments/${tenant}/${box}/${message}/${randomUUID()}`;
  try {
    await db
      .insertInto('tenants')
      .values({ id: tenant, name: 'Metering QA', slug: 'meter-' + tenant })
      .execute();
    await db
      .insertInto('users')
      .values({
        id: user,
        email: user + '@qa.local',
        full_name: 'Metering',
        password_hash: 'fixture-only',
      })
      .execute();
    await db
      .insertInto('mailboxes')
      .values(
        [box, otherBox].map((id) => ({
          id,
          tenant_id: tenant,
          name: 'Caixa QA',
          email_address: id + '@qa.local',
          username: 'qa',
          imap_host: 'localhost',
          smtp_host: 'localhost',
        })),
      )
      .execute();
    await db
      .insertInto('threads')
      .values({ id: thread, tenant_id: tenant, mailbox_id: box })
      .execute();
    const html = '<p>Olá, ação! 密</p>',
      text = 'Mensagem com acentuação';
    await db
      .insertInto('messages')
      .values({
        id: message,
        tenant_id: tenant,
        mailbox_id: box,
        thread_id: thread,
        message_id_header: '<' + message + '@qa>',
        message_at: new Date(),
        direction: 'inbound',
        from_address: 'qa@qa.local',
        from_name: 'Segredo remetente',
        to_addresses: [],
        cc_addresses: [],
        bcc_addresses: [],
        subject: 'Segredo assunto',
        body_html: html,
        body_text: text,
        snippet: 'Segredo conteúdo',
      })
      .execute();
    const storage = new Storage(root, db);
    await storage.writeFile(key, Buffer.alloc(100, 7));
    await db
      .insertInto('attachments')
      .values({
        tenant_id: tenant,
        mailbox_id: box,
        message_id: message,
        filename: 'Segredo nome.txt',
        content_type: 'text/plain',
        size_bytes: 100,
        storage_path: key,
      })
      .execute();
    const before = await db
      .selectFrom('storage_assets')
      .selectAll()
      .where('storage_key', '=', key)
      .executeTakeFirstOrThrow();
    expect(before.present_bytes).toBe('100');
    expect(before.scope).toBe('mailbox');
    await mkdir(dirname(join(root, hardlink)), { recursive: true });
    await link(join(root, key), join(root, hardlink));
    await writeFile(join(root, sparse), '');
    await truncate(join(root, sparse), 1048576);
    for (let i = 0; i < 8; i++) await writeFile(join(root, 'orphan-' + i), Buffer.alloc(1));
    if (process.platform === 'linux') await symlink('/etc/passwd', join(root, 'unsafe-link'));
    const run = await requestStorageScan(db, 'full');
    let batches = 0,
      done = false;
    while (!done && batches++ < 100) done = await reconcileStorage(db, root, run, 2, 20000);
    expect(done).toBe(true);
    expect(await reconcileStorage(db, root, run)).toBe(true);
    expect(batches).toBeGreaterThan(2);
    const tenantSnapshot = await db
      .selectFrom('storage_usage_snapshots')
      .select(['usage', 'quality'])
      .where('scan_id', '=', run)
      .where('scope_id', '=', tenant)
      .executeTakeFirstOrThrow();
    const usage = tenantSnapshot.usage as {
      file_bytes: string;
      body_bytes: string;
      attributed_bytes: string;
      logical_bytes: string;
    };
    expect(usage.file_bytes).toBe('1048676');
    await db
      .updateTable('messages')
      .set({ deleted_at: new Date() })
      .where('id', '=', message)
      .execute();
    expect(
      (
        await db
          .selectFrom('storage_logical_payloads')
          .select('retained')
          .where('relation_name', '=', 'attachments')
          .where('tenant_id', '=', tenant)
          .executeTakeFirstOrThrow()
      ).retained,
    ).toBe(true);
    expect(usage.body_bytes).toBe(String(Buffer.byteLength(html + text)));
    expect(BigInt(usage.attributed_bytes)).toBe(
      BigInt(usage.file_bytes) + BigInt(usage.logical_bytes),
    );
    expect(JSON.stringify(tenantSnapshot)).not.toMatch(/Segredo|storage_key|password_hash/);
    const physical = await db
      .selectFrom('storage_assets')
      .select(['allocated_bytes', 'present_bytes'])
      .where('storage_key', '=', sparse)
      .executeTakeFirstOrThrow();
    if (process.platform === 'linux')
      expect(BigInt(physical.allocated_bytes!)).toBeLessThan(BigInt(physical.present_bytes!));
    // A stale scanner cannot overwrite a completed runtime write.
    const stale = await storage.inspect(key),
      revision = before.revision;
    await storage.writeFile(key, Buffer.alloc(200, 8));
    await observeStorageFile(db, key, stale, undefined, run, revision);
    expect(
      (
        await db
          .selectFrom('storage_assets')
          .select('present_bytes')
          .where('storage_key', '=', key)
          .executeTakeFirstOrThrow()
      ).present_bytes,
    ).toBe('200');
    // An unavailable root preserves the previously published totals.
    const broken = await requestStorageScan(db, 'full');
    expect(await reconcileStorage(db, join(root, 'not-present'), broken)).toBe(true);
    expect(
      await db
        .selectFrom('storage_scan_runs')
        .select(['state', 'published_at'])
        .where('id', '=', broken)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ state: 'partial', published_at: null });
    expect(await reconcileStorage(db, root, broken)).toBe(true);
    expect(await lstat(root)).toBeDefined();
    await storage.removeFile(key);
    await refreshDiscrepancies(db);
    expect(
      await db
        .selectFrom('storage_discrepancies')
        .select('id')
        .where('code', '=', 'missing_file')
        .where('tenant_id', '=', tenant)
        .where('resolved_at', 'is', null)
        .executeTakeFirst(),
    ).toBeDefined();
    const publication = await requestStorageScan(db, 'publish');
    await publishStorageUsage(db, publication);
    const end = await db
      .selectFrom('storage_usage_snapshots')
      .select('usage')
      .where('scan_id', '=', publication)
      .where('scope_id', '=', tenant)
      .executeTakeFirstOrThrow();
    // Remaining hardlink still consumes its own bytes, while absent original consumes zero.
    expect((end.usage as { file_bytes: string }).file_bytes).toBe('1048676');
    await sql`update storage_assets set created_at=now()-interval '10 minutes' where tenant_id=${tenant}::uuid`.execute(
      db,
    );
    await refreshDiscrepancies(db);
    expect(
      await db
        .selectFrom('storage_discrepancies')
        .select('id')
        .where('code', '=', 'unreferenced_file')
        .where('tenant_id', '=', tenant)
        .executeTakeFirst(),
    ).toBeDefined();
  } finally {
    await db.destroy();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);

it('fecha totais de caixas e compartilhados, deduplica conflito entre empresas e serializa duas conexões', async () => {
  const url = process.env.DATABASE_URL_TEST!;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Banco exclusivo obrigatório');
  const db = createDb(url),
    root = await mkdtemp(join(tmpdir(), 'apmail-metering-ownership-'));
  const tenant = randomUUID(),
    foreignTenant = randomUUID(),
    user = randomUUID(),
    box = randomUUID(),
    otherBox = randomUUID(),
    foreignBox = randomUUID(),
    upload = randomUUID();
  const storage = new Storage(root, db);
  const uploadKey = `uploads/${tenant}/${user}/${upload}`,
    attachmentKey = `attachments/${tenant}/${box}/${randomUUID()}/${randomUUID()}`,
    otherKey = `attachments/${tenant}/${otherBox}/${randomUUID()}/${randomUUID()}`,
    foreignKey = `attachments/${foreignTenant}/${foreignBox}/${randomUUID()}/${randomUUID()}`;
  try {
    await db
      .insertInto('tenants')
      .values(
        [tenant, foreignTenant].map((id) => ({
          id,
          name: 'Ownership QA',
          slug: 'ownership-' + id,
        })),
      )
      .execute();
    await db
      .insertInto('users')
      .values({
        id: user,
        email: user + '@qa.local',
        full_name: 'Ownership QA',
        password_hash: 'fixture-only',
      })
      .execute();
    await db
      .insertInto('mailboxes')
      .values(
        [
          [box, tenant],
          [otherBox, tenant],
          [foreignBox, foreignTenant],
        ].map(([id, tenantId]) => ({
          id: id!,
          tenant_id: tenantId!,
          name: 'Caixa ownership',
          email_address: id + '@qa.local',
          username: 'qa',
          imap_host: 'localhost',
          smtp_host: 'localhost',
        })),
      )
      .execute();
    await storage.writeFile(uploadKey, Buffer.alloc(100));
    await storage.writeFile(attachmentKey, Buffer.alloc(40));
    await storage.writeFile(otherKey, Buffer.alloc(30));
    await storage.writeFile(`signatures/${tenant}/${user}/${randomUUID()}.png`, Buffer.alloc(15));
    await storage.writeFile(`avatars/${user}/${randomUUID()}.png`, Buffer.alloc(5));
    await db
      .insertInto('uploads')
      .values({
        id: upload,
        tenant_id: tenant,
        user_id: user,
        filename: 'fixture',
        content_type: 'text/plain',
        size_bytes: 100,
        storage_path: uploadKey,
      })
      .execute();
    const draft = randomUUID();
    await db
      .insertInto('outbox')
      .values({
        id: draft,
        tenant_id: tenant,
        mailbox_id: box,
        created_by: user,
        attachments: sql`${JSON.stringify([{ source: 'upload', upload_id: upload }])}::jsonb`,
      })
      .execute();
    await refreshStorageOwnership(db);
    expect(
      await db
        .selectFrom('storage_assets')
        .select(['scope', 'mailbox_id'])
        .where('storage_key', '=', uploadKey)
        .executeTakeFirst(),
    ).toMatchObject({ scope: 'mailbox', mailbox_id: box });
    await db
      .insertInto('outbox')
      .values({
        tenant_id: tenant,
        mailbox_id: otherBox,
        created_by: user,
        attachments: sql`${JSON.stringify([{ source: 'upload', upload_id: upload }])}::jsonb`,
      })
      .execute();
    await refreshStorageOwnership(db);
    expect(
      await db
        .selectFrom('storage_assets')
        .select(['scope', 'mailbox_id'])
        .where('storage_key', '=', uploadKey)
        .executeTakeFirst(),
    ).toMatchObject({ scope: 'tenant', mailbox_id: null });
    const run = await requestStorageScan(db, 'full');
    await db.connection().execute(async (connection) => {
      await sql`select pg_advisory_lock(hashtext('apmail:storage-metering'))`.execute(connection);
      try {
        expect(await reconcileStorage(db, root, run)).toBe(false);
      } finally {
        await sql`select pg_advisory_unlock(hashtext('apmail:storage-metering'))`.execute(
          connection,
        );
      }
    });
    expect(await reconcileStorage(db, root, run)).toBe(true);
    const read = async (id: string, scan: string) =>
      (
        await db
          .selectFrom('storage_usage_snapshots')
          .select('usage')
          .where('scope_id', '=', id)
          .where('scan_id', '=', scan)
          .executeTakeFirstOrThrow()
      ).usage as {
        file_bytes: string;
        shared_file_bytes: string;
        shared_logical_bytes: string;
        attributed_bytes: string;
      };
    const company = await read(tenant, run),
      first = await read(box, run),
      second = await read(otherBox, run);
    expect(company.file_bytes).toBe('185');
    expect(company.shared_file_bytes).toBe('115');
    expect(
      BigInt(first.attributed_bytes) +
        BigInt(second.attributed_bytes) +
        BigInt(company.shared_file_bytes) +
        BigInt(company.shared_logical_bytes),
    ).toBe(BigInt(company.attributed_bytes));
    expect((await read('00000000-0000-0000-0000-000000000000', run)).file_bytes).toBe('5');
    await mkdir(dirname(join(root, foreignKey)), { recursive: true });
    await link(join(root, attachmentKey), join(root, foreignKey));
    const conflict = await requestStorageScan(db, 'full');
    expect(await reconcileStorage(db, root, conflict)).toBe(true);
    expect((await read(tenant, conflict)).file_bytes).toBe('145');
    expect((await read(foreignTenant, conflict)).file_bytes).toBe('0');
    expect((await read('00000000-0000-0000-0000-000000000001', conflict)).file_bytes).toBe('40');
    expect(
      await db
        .selectFrom('storage_discrepancies')
        .select('id')
        .where('code', '=', 'cross_tenant_reference')
        .where('tenant_id', 'in', [tenant, foreignTenant])
        .where('resolved_at', 'is', null)
        .execute(),
    ).toHaveLength(2);
    await db
      .updateTable('uploads')
      .set({ consumed_at: new Date() })
      .where('id', '=', upload)
      .execute();
    expect(
      await db
        .selectFrom('storage_asset_refs')
        .select('asset_id')
        .where('source_kind', '=', 'uploads')
        .where('source_id', '=', upload)
        .execute(),
    ).toHaveLength(0);
    await storage.removeFile(uploadKey);
    const end = await requestStorageScan(db, 'publish');
    await publishStorageUsage(db, end);
    expect((await read(tenant, end)).file_bytes).toBe('45');
  } finally {
    await db.destroy();
    await rm(root, { recursive: true, force: true });
  }
}, 60000);
