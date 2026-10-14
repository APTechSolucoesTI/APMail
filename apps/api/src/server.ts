import { buildApp } from './app.js';
import { readEnv } from './env.js';
import { migrate } from '@apmail/db';
const env = readEnv();
if (env.NODE_ENV === 'production') await migrate(env.DATABASE_URL);
const app = await buildApp(env);
await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await app.close();
    process.exit(0);
  });
