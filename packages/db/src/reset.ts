import './config.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';
import { migrate } from './migrate.js';
export async function resetDatabase(url: string): Promise<void> {
  if (process.env.NODE_ENV === 'production')
    throw new Error('Reset do banco é proibido em produção.');
  const name = new URL(url).pathname.slice(1);
  if (!['apmail', 'apmail_test'].includes(name))
    throw new Error('Reset permitido somente nos bancos exclusivos apmail e apmail_test.');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('drop schema public cascade; create schema public;');
  } finally {
    await client.end();
  }
  await migrate(url);
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === fileURLToPath(pathToFileURL(process.argv[1]))
) {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não foi configurada.');
  await resetDatabase(process.env.DATABASE_URL);
  console.info('Banco de desenvolvimento recriado e migrations aplicadas.');
}
