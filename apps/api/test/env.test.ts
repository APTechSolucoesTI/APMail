import { expect, it } from 'vitest';
import { envSchema } from '../src/env.js';
it('rejeita configurações e chaves incompletas antes de iniciar', () => {
  const result = envSchema.safeParse({ APP_URL: 'inválida', SESSION_SECRET: 'curto' });
  expect(result.success).toBe(false);
});
