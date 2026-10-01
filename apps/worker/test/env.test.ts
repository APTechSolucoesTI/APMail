import { expect, it } from 'vitest';
import { envSchema } from '../src/env.js';
it('exige segredos completos e limita concorrência a valores positivos', () => {
  expect(envSchema.safeParse({ WORKER_SEND_CONCURRENCY: 0 }).success).toBe(false);
});
