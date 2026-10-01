import { expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
it('verifica Postgres e Redis reais e não expõe o Swagger em teste', async () => {
  const config = envSchema.parse({
    ...process.env,
    NODE_ENV: 'test',
    DATABASE_URL: process.env.DATABASE_URL_TEST,
    REDIS_URL: process.env.REDIS_URL_TEST,
    APP_URL: 'http://localhost:5173',
    SESSION_SECRET: randomBytes(32).toString('base64'),
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  });
  const app = await buildApp(config);
  try {
    const response = await app.inject({ url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', db: 'ok', redis: 'ok' });
    expect((await app.inject({ url: '/api/docs' })).statusCode).toBe(404);
  } finally {
    await app.close();
  }
}, 30000);
