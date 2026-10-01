import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { Redis } from 'ioredis';
export async function withMailboxLock<T>(
  redis: Redis,
  mailboxId: string,
  jobId: string,
  work: () => Promise<T>,
  waitMs = 0,
): Promise<T | 'skipped'> {
  const key = 'lock:mailbox-sync:' + mailboxId,
    token = jobId + ':' + randomUUID(),
    start = Date.now();
  while ((await redis.set(key, token, 'PX', 600000, 'NX')) !== 'OK') {
    if (Date.now() - start >= waitMs) return 'skipped';
    await delay(200);
  }
  let lost = false;
  const renew = setInterval(
    () =>
      void redis
        .eval(
          "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('pexpire',KEYS[1],ARGV[2]) else return 0 end",
          1,
          key,
          token,
          600000,
        )
        .then((ok) => {
          if (!ok) lost = true;
        })
        .catch(() => {
          lost = true;
        }),
    60000,
  );
  try {
    const result = await work();
    if (lost) throw new Error('Lock da caixa expirou.');
    return result;
  } finally {
    clearInterval(renew);
    await redis
      .eval(
        "if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) else return 0 end",
        1,
        key,
        token,
      )
      .catch(() => undefined);
  }
}
