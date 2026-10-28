import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb, migrate, asJson, requestTenantQueueRefresh } from '@apmail/db';
import { refreshTenantQueues } from '../../src/handlers/refresh-tenant-queues.js';
import type { WorkerResources } from '../../src/resources.js';
const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test')) throw Error('QA only');
const db = createDb(url),
  tenant = randomUUID(),
  box = randomUUID();
const r = { db, io: { to: () => ({ emit: () => undefined }) } } as unknown as WorkerResources;
beforeAll(async () => {
  await migrate(url);
  await db
    .insertInto('tenants')
    .values({
      id: tenant,
      name: 'Refresh QA',
      slug: tenant,
      settings: asJson({ mail_queues_enabled: true }),
    })
    .execute();
  await db
    .insertInto('mailboxes')
    .values({
      id: box,
      tenant_id: tenant,
      name: 'QA',
      email_address: 'qa@example.test',
      username: 'qa',
      imap_host: 'localhost',
      smtp_host: 'localhost',
    })
    .execute();
  await db
    .insertInto('threads')
    .values({
      tenant_id: tenant,
      mailbox_id: box,
      manual_done_at: new Date(),
      queue_status: 'done',
    })
    .execute();
});
afterAll(async () => db.destroy());
it('ignores superseded generations and preserves valid manual completion', async () => {
  const stale = await requestTenantQueueRefresh(db, tenant),
    current = await requestTenantQueueRefresh(db, tenant);
  await refreshTenantQueues(r, { tenant_id: tenant, generation: stale });
  let run = await db
    .selectFrom('tenant_mail_policy_runs')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .executeTakeFirstOrThrow();
  expect(run.processed).toBe(0);
  expect(run.generation).toBe(current);
  await refreshTenantQueues(r, { tenant_id: tenant, generation: current });
  run = await db
    .selectFrom('tenant_mail_policy_runs')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .executeTakeFirstOrThrow();
  expect(run.state).toBe('succeeded');
  expect(run.processed).toBe(1);
  expect(
    (
      await db
        .selectFrom('threads')
        .select('queue_status')
        .where('mailbox_id', '=', box)
        .executeTakeFirstOrThrow()
    ).queue_status,
  ).toBe('done');
});
it('persists a safe failure without overwriting a newer refresh generation', async () => {
  const generation = await requestTenantQueueRefresh(db, tenant);
  const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(
    () =>
      ({
        execute: async () => {
          throw Error('secret connection string');
        },
      }) as unknown as ReturnType<typeof db.transaction>,
  );
  await expect(refreshTenantQueues(r, { tenant_id: tenant, generation })).rejects.toThrow();
  spy.mockRestore();
  const run = await db
    .selectFrom('tenant_mail_policy_runs')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .executeTakeFirstOrThrow();
  expect(run.state).toBe('failed');
  expect(run.error).not.toContain('secret');
});
it('does not let an obsolete failure overwrite the new refresh generation', async () => {
  const stale = await requestTenantQueueRefresh(db, tenant),
    current = await requestTenantQueueRefresh(db, tenant);
  const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(
    () =>
      ({
        execute: async () => {
          throw Error('obsolete failure');
        },
      }) as unknown as ReturnType<typeof db.transaction>,
  );
  await expect(refreshTenantQueues(r, { tenant_id: tenant, generation: stale })).rejects.toThrow();
  spy.mockRestore();
  const run = await db
    .selectFrom('tenant_mail_policy_runs')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .executeTakeFirstOrThrow();
  expect(run.generation).toBe(current);
  expect(run.state).toBe('queued');
  expect(run.error).toBeNull();
});
