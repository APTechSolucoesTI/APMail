import './config.js';
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
export async function migrate(
  databaseUrl: string,
  directory = new URL('../migrations/', import.meta.url),
): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('select pg_advisory_lock(727274)');
    await client.query(
      'create table if not exists schema_migrations (version text primary key, checksum text not null, applied_at timestamptz not null default now())',
    );
    const applied = await client.query<{ version: string; checksum: string }>(
      'select version, checksum from schema_migrations',
    );
    const versions = new Map(applied.rows.map((row) => [row.version, row.checksum]));
    const files = (await readdir(directory)).filter((file) => /^\d{4}_.+\.sql$/.test(file)).sort();
    for (const file of files) {
      const contents = await readFile(new URL(file, directory), 'utf8');
      const checksum = createHash('sha256').update(contents).digest('hex');
      if (versions.has(file)) {
        if (versions.get(file) !== checksum)
          throw new Error(
            `A migration ${file} já foi aplicada e seu checksum mudou. Migrations aplicadas não podem ser editadas.`,
          );
        continue;
      }
      await client.query('begin');
      try {
        await client.query(contents);
        await client.query('insert into schema_migrations (version, checksum) values ($1, $2)', [
          file,
          checksum,
        ]);
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(727274)').catch(() => undefined);
    await client.end();
  }
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))
) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não foi configurada.');
  await migrate(process.env.DATABASE_URL);
  console.info('Migrations aplicadas.');
}
