import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import pg from 'pg';
import { migrate } from '../../src/migrate.js';
import { resetDatabase } from '../../src/reset.js';
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
