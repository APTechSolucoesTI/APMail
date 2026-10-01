import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import pg from 'pg';
import { migrate } from '../../src/migrate.js';
import { resetDatabase } from '../../src/reset.js';
import { randomUUID } from 'node:crypto';
import { createDb } from '../../src/client.js';
import { touchThreads } from '../../src/domain/threads.js';
it('aplica do zero, impede mudança de checksum e mantém transação', async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url || !new URL(url).pathname.endsWith('_test'))
    throw new Error('DATABASE_URL_TEST precisa identificar um banco de teste exclusivo.');
  await resetDatabase(url);
  const folder = await mkdtemp(join(tmpdir(), 'apmail-migration-'));
  const directory = pathToFileURL(folder + sep);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await writeFile(join(folder, '9900_teste.sql'), 'create table migration_probe (id integer);');
    await migrate(url, directory);
    await migrate(url, directory);
    await writeFile(join(folder, '9900_teste.sql'), 'create table migration_probe (id text);');
    await expect(migrate(url, directory)).rejects.toThrow('checksum mudou');
    await writeFile(join(folder, '9900_teste.sql'), 'create table migration_probe (id integer);');
    await writeFile(
      join(folder, '9901_falha.sql'),
      'create table rollback_probe (id integer); select missing_column;',
    );
    await expect(migrate(url, directory)).rejects.toThrow();
    expect(
      (await client.query("select to_regclass('rollback_probe') as name")).rows[0].name,
    ).toBeNull();
    expect(
      (
        await client.query('select count(*)::int as n from schema_migrations where version=$1', [
          '9900_teste.sql',
        ])
      ).rows[0].n,
    ).toBe(1);
  } finally {
    await client.end();
    await rm(folder, { recursive: true, force: true });
    await resetDatabase(url);
  }
}, 30000);
it('serializa recomputações concorrentes e grava somente uma transição por mudança', async () => {
  const url = process.env.DATABASE_URL_TEST!;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Banco exclusivo obrigatório.');
  await migrate(url);
  const db = createDb(url),
    tenant = randomUUID(),
    mailbox = randomUUID(),
    thread = randomUUID();
  try {
    await db
      .insertInto('tenants')
      .values({ id: tenant, name: 'Concorrência QA', slug: 'locks-' + tenant })
      .execute();
    await db
      .insertInto('mailboxes')
      .values({
        id: mailbox,
        tenant_id: tenant,
        name: 'Caixa QA',
        email_address: 'qa@apmail.local',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        username: 'qa',
        status: 'disabled',
      })
      .execute();
    await db
      .insertInto('threads')
      .values({ id: thread, tenant_id: tenant, mailbox_id: mailbox })
      .execute();
    await db
      .insertInto('messages')
      .values({
        tenant_id: tenant,
        mailbox_id: mailbox,
        thread_id: thread,
        message_id_header: '<' + randomUUID() + '@qa>',
        direction: 'inbound',
        from_address: 'cliente@cliente.local',
        message_at: new Date(),
      })
      .execute();
    await Promise.all(
      Array.from({ length: 4 }, () =>
        db.transaction().execute((tx) => touchThreads(tx, [thread], 'inbound', null)),
      ),
    );
    expect(
      (
        await db
          .selectFrom('threads')
          .select('queue_status')
          .where('id', '=', thread)
          .executeTakeFirstOrThrow()
      ).queue_status,
    ).toBe('to_reply');
    const history = await db
      .selectFrom('thread_status_history')
      .selectAll()
      .where('thread_id', '=', thread)
      .execute();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      from_status: 'none',
      to_status: 'to_reply',
      reason: 'inbound',
      changed_by: null,
    });
    const foreignTenant = await db
      .insertInto('tenants')
      .values({ name: 'Outro QA', slug: 'foreign-' + tenant })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(
      db
        .insertInto('thread_status_history')
        .values({
          tenant_id: foreignTenant.id,
          mailbox_id: mailbox,
          thread_id: thread,
          to_status: 'done',
          reason: 'manual',
        })
        .execute(),
    ).rejects.toThrow();
  } finally {
    await db.destroy();
  }
}, 30000);
