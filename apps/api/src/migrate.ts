import { loadRootEnv, migrate } from '@apmail/db';
loadRootEnv();
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL não foi configurada.');
await migrate(process.env.DATABASE_URL);
console.info('Migrations aplicadas.');
