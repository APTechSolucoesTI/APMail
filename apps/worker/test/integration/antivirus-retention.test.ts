import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { sql } from 'kysely';
import { createDb, migrate, Storage } from '@apmail/db';
import type { WorkerResources } from '../../src/resources.js';
import { cleanupPstExports } from '../../src/handlers/pst-export.js';
import { cleanupMailArchiveFiles } from '../../src/handlers/mail-archive-maintenance.js';
import { cleanupUploads } from '../../src/handlers/outbox-maintenance.js';
const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Banco de teste exclusivo obrigatório.');
const db = createDb(url),
  tenant = randomUUID(),
  user = randomUUID(),
  box = randomUUID();
const dir = await mkdtemp(join(tmpdir(), 'apmail-antivirus-retention-'));
const storage = new Storage(dir);
const resources = () =>
  ({
    db,
    storage,
    redis: { set: async () => 'OK', eval: async () => 1 },
    log: { warn: () => undefined },
  }) as unknown as WorkerResources;
beforeAll(async () => {
  await migrate(url);
  await db
    .insertInto('tenants')
    .values({ id: tenant, name: 'Retenção AV QA', slug: 'av-' + tenant })
    .execute();
  await db
    .insertInto('users')
    .values({
      id: user,
      email: user + '@example.test',
      full_name: 'QA',
      password_hash: 'not-a-login',
    })
    .execute();
  await db
    .insertInto('mailboxes')
    .values({
      id: box,
      tenant_id: tenant,
      name: 'QA',
      email_address: 'qa@example.test',
      username: 'qa@example.test',
      imap_host: 'localhost',
      smtp_host: 'localhost',
      receiving_protocol: 'local',
      status: 'active',
    })
    .execute();
});
afterAll(async () => {
  await db.deleteFrom('mail_archive_export_files').where('tenant_id', '=', tenant).execute();
  await db.deleteFrom('mail_archive_exports').where('tenant_id', '=', tenant).execute();
  await db.deleteFrom('mail_archive_imports').where('tenant_id', '=', tenant).execute();
  await db.deleteFrom('uploads').where('tenant_id', '=', tenant).execute();
  await db.deleteFrom('storage_assets').where('tenant_id', '=', tenant).execute();
  await db.deleteFrom('mailboxes').where('id', '=', box).execute();
  await db.deleteFrom('tenant_storage_limits').where('tenant_id', '=', tenant).execute();
  await db.deleteFrom('tenants').where('id', '=', tenant).execute();
  await db.deleteFrom('users').where('id', '=', user).execute();
  await db.destroy();
  await rm(dir, { recursive: true, force: true });
});
it('a retenção automática apaga só upload limpo e preserva arquivos infectados, pendentes, com erro ou sem análise', async () => {
  const paths = new Map<string, string>();
  for (const status of ['clean', 'infected', 'pending', 'error', 'untracked']) {
    const id = randomUUID(),
      path = `uploads/${tenant}/${id}`;
    paths.set(status, path);
    await storage.writeFile(path, Buffer.from('Arquivo para retenção ' + status));
    await db
      .insertInto('uploads')
      .values({
        id,
        tenant_id: tenant,
        user_id: user,
        storage_path: path,
        content_type: 'application/octet-stream',
        filename: status + '.bin',
        size_bytes: 32,
        created_at: new Date(Date.now() - 2 * 86400000),
      })
      .execute();
    if (status !== 'untracked')
      await sql`insert into file_security
      (storage_key,tenant_id,user_id,resource_id,kind,filename,size_bytes,status,sha256,scanned_at)
      values (${path},${tenant},${user},${id},'upload',${status + '.bin'},32,${status},
      ${status === 'clean' ? 'a'.repeat(64) : null},${status === 'clean' ? new Date() : null})`.execute(
        db,
      );
  }
  await cleanupUploads({ db, storage } as unknown as WorkerResources);
  const remaining = await db
    .selectFrom('uploads')
    .select('filename')
    .where('tenant_id', '=', tenant)
    .execute();
  expect(remaining.map((f) => f.filename).sort()).toEqual([
    'error.bin',
    'infected.bin',
    'pending.bin',
    'untracked.bin',
  ]);
  expect(await storage.inspect(paths.get('clean')!)).toBe(null);
  for (const status of ['infected', 'pending', 'error', 'untracked'])
    expect(await storage.inspect(paths.get(status)!)).not.toBe(null);
});

it('a expiração automática do PST preserva saída em quarentena ou aguardando análise', async () => {
  const paths = new Map<string, string>();
  for (const status of ['clean', 'infected', 'pending', 'error', 'untracked']) {
    const id = randomUUID(),
      path = `mail-exports/${tenant}/${box}/${id}/output/backup.pst`;
    paths.set(status, path);
    await storage.writeFile(path, Buffer.from('PST ' + status));
    await db
      .insertInto('mail_archive_exports')
      .values({
        id,
        tenant_id: tenant,
        mailbox_id: box,
        created_by: user,
        filename: 'backup.pst',
        state: 'ready',
        expires_at: new Date(Date.now() - 1000),
      })
      .execute();
    await db
      .insertInto('mail_archive_export_files')
      .values({
        export_id: id,
        tenant_id: tenant,
        mailbox_id: box,
        kind: 'pst',
        filename: 'backup.pst',
        storage_path: path,
        size_bytes: '32',
      })
      .execute();
    if (status !== 'untracked')
      await sql`insert into file_security
      (storage_key,tenant_id,mailbox_id,user_id,resource_id,kind,filename,size_bytes,status,sha256,scanned_at)
      values (${path},${tenant},${box},${user},${id},'mail_export','backup.pst',32,${status},
      ${status === 'clean' ? 'a'.repeat(64) : null},${status === 'clean' ? new Date() : null})`.execute(
        db,
      );
  }
  await cleanupPstExports(resources());
  expect(await storage.inspect(paths.get('clean')!)).toBe(null);
  for (const status of ['infected', 'pending', 'error', 'untracked'])
    expect(await storage.inspect(paths.get(status)!)).not.toBe(null);
});

it('a limpeza da importação concluída aguarda veredito limpo antes de excluir o contêiner', async () => {
  const paths = new Map<string, string>();
  for (const status of ['clean', 'infected', 'pending', 'error', 'untracked']) {
    const id = randomUUID(),
      path = `mail-imports/${tenant}/${box}/${id}/source.mbox`;
    paths.set(status, path);
    await storage.writeFile(path, Buffer.from('MBOX ' + status));
    await db
      .insertInto('mail_archive_imports')
      .values({
        id,
        tenant_id: tenant,
        mailbox_id: box,
        created_by: user,
        filename: 'source.mbox',
        format: 'mbox',
        state: 'completed',
        size_bytes: '32',
        storage_path: path,
      })
      .execute();
    if (status !== 'untracked')
      await sql`insert into file_security
      (storage_key,tenant_id,mailbox_id,user_id,resource_id,kind,filename,size_bytes,status,sha256,scanned_at)
      values (${path},${tenant},${box},${user},${id},'mail_import','source.mbox',32,${status},
      ${status === 'clean' ? 'a'.repeat(64) : null},${status === 'clean' ? new Date() : null})`.execute(
        db,
      );
  }
  await cleanupMailArchiveFiles(resources());
  expect(await storage.inspect(paths.get('clean')!)).toBe(null);
  for (const status of ['infected', 'pending', 'error', 'untracked'])
    expect(await storage.inspect(paths.get(status)!)).not.toBe(null);
});
