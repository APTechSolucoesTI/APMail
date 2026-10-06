import { mkdtemp, writeFile, rm, readdir, copyFile } from 'node:fs/promises';
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
it('migra contatos existentes com cota cheia, preserva canais e atualiza a medição', async () => {
  const url = process.env.DATABASE_URL_TEST;
  if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('Banco exclusivo obrigatório.');
  const directory = await mkdtemp(join(tmpdir(), 'apmail-contacts-migration-'));
  const source = new URL('../../migrations/', import.meta.url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    if (process.env.NODE_ENV === 'production') throw Error('Reset proibido em produção.');
    await client.query('drop schema public cascade; create schema public;');
    for (const file of await readdir(source))
      if (/^\d{4}_.+\.sql$/.test(file) && file < '0020')
        await copyFile(new URL(file, source), join(directory, file));
    await migrate(url, pathToFileURL(directory + sep));
    const tenant = randomUUID(),
      user = randomUUID(),
      contact = randomUUID(),
      company = randomUUID();
    await client.query('insert into tenants(id,name,slug) values($1,$2,$3)', [
      tenant,
      'Migration QA',
      'migration-' + tenant,
    ]);
    await client.query('insert into users(id,email,full_name,password_hash) values($1,$2,$3,$4)', [
      user,
      user + '@qa.local',
      'QA',
      'fixture',
    ]);
    await client.query(
      'insert into contacts(id,tenant_id,name,phone,created_by) values($1,$2,$3,$4,$5)',
      [contact, tenant, 'Contato existente', '(11) 3333-2222', user],
    );
    const emails = (
      await client.query(
        'insert into contact_emails(tenant_id,contact_id,email) values($1,$2,$3),($1,$2,$4) returning id,email',
        [tenant, contact, 'z@qa.local', 'a@qa.local'],
      )
    ).rows;
    await client.query('insert into contact_companies(id,tenant_id,name) values($1,$2,$3)', [
      company,
      tenant,
      'Empresa existente',
    ]);
    const mailbox = randomUUID(),
      addressId = randomUUID();
    await client.query(
      "insert into mailboxes(id,tenant_id,name,email_address,username,imap_host,smtp_host,status) values($1,$2,'QA','qa@qa.local','qa','localhost','localhost','disabled')",
      [mailbox, tenant],
    );
    await client.query("update contacts set visibility='selected' where id=$1", [contact]);
    await client.query(
      'insert into contact_mailboxes(tenant_id,contact_id,mailbox_id) values($1,$2,$3)',
      [tenant, contact, mailbox],
    );
    await client.query(
      "insert into contact_addresses(id,tenant_id,cep,street) values($1,$2,'01001000','Rua migrada')",
      [addressId, tenant],
    );
    for (const email of emails)
      await client.query(
        'insert into contact_email_links(tenant_id,email_id,company_id,address_id) values($1,$2,$3,$4)',
        [tenant, email.id, company, addressId],
      );
    await client.query(
      'update tenant_storage_limits set storage_limit_bytes=storage_quota_usage($1) where tenant_id=$1',
      [tenant],
    );
    await migrate(url);
    const migratedCompany = (
      await client.query('select visibility,addresses from contact_companies where id=$1', [
        company,
      ])
    ).rows[0];
    expect(migratedCompany.visibility).toBe('selected');
    expect(migratedCompany.addresses).toHaveLength(1);
    expect(migratedCompany.addresses[0]).toMatchObject({ street: 'Rua migrada', cep: '01001000' });
    expect(
      (
        await client.query('select mailbox_id from contact_company_mailboxes where company_id=$1', [
          company,
        ])
      ).rows,
    ).toEqual([{ mailbox_id: mailbox }]);
    expect(
      (
        await client.query(
          "select count(*)::int as n from storage_logical_payloads where relation_name='contact_company_mailboxes' and tenant_id=$1",
          [tenant],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (await client.query('select phone,phones,job_title from contacts where id=$1', [contact]))
        .rows[0],
    ).toMatchObject({
      phone: '(11) 3333-2222',
      phones: [{ number: '(11) 3333-2222', label: '', is_primary: true }],
      job_title: '',
    });
    expect(
      (
        await client.query('select email from contact_emails where contact_id=$1 and is_primary', [
          contact,
        ])
      ).rows,
    ).toEqual([{ email: 'a@qa.local' }]);
    expect(
      (
        await client.query(
          'select count(*)::int as n from contact_email_links where contact_id=$1 and is_primary_company',
          [contact],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await client.query(
          'select count(*)::int as n from contact_email_links where contact_id=$1',
          [contact],
        )
      ).rows[0].n,
    ).toBe(2);
    const measured = (
      await client.query(
        "select p.metadata_bytes::text as actual,octet_length((to_jsonb(c)-catalog.excluded_columns)::text)::bigint::text as expected from storage_logical_payloads p join contacts c on p.row_key=jsonb_build_object('id',c.id)::text join storage_logical_catalog catalog on catalog.relation_name=p.relation_name where p.relation_name='contacts' and c.id=$1",
        [contact],
      )
    ).rows[0];
    expect(measured).toMatchObject({ actual: expect.any(String), expected: expect.any(String) });
    expect(measured.actual).toBe(measured.expected);
    expect(
      (
        await client.query(
          "select count(*)::int as n from pg_trigger where tgname='storage_payload_track' and tgenabled='O' and tgrelid in ('contacts'::regclass,'contact_emails'::regclass,'contact_email_links'::regclass)",
        )
      ).rows[0].n,
    ).toBe(3);
  } finally {
    await client.end();
    await rm(directory, { recursive: true, force: true });
    await resetDatabase(url);
    await migrate(url);
  }
}, 120000);
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
