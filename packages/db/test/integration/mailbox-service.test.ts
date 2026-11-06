import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb } from '../../src/client.js';
import { migrate } from '../../src/migrate.js';
import {
  asJson,
  recomputeThreadStatus,
  refreshThreadAggregates,
} from '../../src/domain/threads.js';
import {
  assignIndividualMailboxOwnerOnInbound,
  mailboxOwnerEligible,
  startThreadService,
} from '../../src/domain/mailbox-service.js';
const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Dedicated test database required');
const db = createDb(url);
beforeAll(async () => migrate(url), 60000);
afterAll(async () => db.destroy());
async function fixture(individual = true) {
  const tenant = randomUUID(),
    owner = randomUUID(),
    other = randomUUID(),
    box = randomUUID(),
    thread = randomUUID();
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('tenants')
      .values({ id: tenant, name: 'Service QA', slug: tenant })
      .execute();
    await tx
      .insertInto('users')
      .values(
        [owner, other].map((id) => ({
          id,
          email: id + '@service.test',
          full_name: 'Service QA',
          password_hash: 'fixture',
        })),
      )
      .execute();
    await tx
      .insertInto('tenant_members')
      .values([owner, other].map((user_id) => ({ user_id, tenant_id: tenant })))
      .execute();
    await tx
      .insertInto('mailboxes')
      .values({
        id: box,
        tenant_id: tenant,
        name: 'Service',
        email_address: box + '@service.test',
        username: 'qa',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        box_type: individual ? 'individual' : 'global',
        owner_user_id: individual ? owner : null,
        queues_enabled: false,
      })
      .execute();
    await tx
      .insertInto('mailbox_members')
      .values(
        [owner, other].map((user_id) => ({
          tenant_id: tenant,
          mailbox_id: box,
          user_id,
          role: 'editor' as const,
        })),
      )
      .execute();
    await tx
      .insertInto('threads')
      .values({
        id: thread,
        tenant_id: tenant,
        mailbox_id: box,
        subject: 'Service QA',
        subject_normalized: 'service qa',
        last_inbound_at: new Date('2026-01-01'),
      })
      .execute();
  });
  return { tenant, owner, other, box, thread };
}
it('refuses individual boxes with no eligible owner and does not grant access silently', async () => {
  const f = await fixture(false);
  await expect(
    db.updateTable('mailboxes').set({ box_type: 'individual' }).where('id', '=', f.box).execute(),
  ).rejects.toThrow('active send-capable owner');
  await db
    .deleteFrom('mailbox_members')
    .where('mailbox_id', '=', f.box)
    .where('user_id', '=', f.owner)
    .execute();
  expect(await mailboxOwnerEligible(db, f.tenant, f.box, f.owner)).toBe(false);
  await expect(
    db
      .updateTable('mailboxes')
      .set({ box_type: 'individual', owner_user_id: f.owner })
      .where('id', '=', f.box)
      .execute(),
  ).rejects.toThrow('active send-capable owner');
});
it('blocks disabling, removing or downgrading the owner and permits an atomic transfer', async () => {
  const f = await fixture();
  await expect(
    db
      .updateTable('tenant_members')
      .set({ status: 'disabled' })
      .where('tenant_id', '=', f.tenant)
      .where('user_id', '=', f.owner)
      .execute(),
  ).rejects.toThrow('active send-capable owner');
  await expect(
    db
      .deleteFrom('mailbox_members')
      .where('mailbox_id', '=', f.box)
      .where('user_id', '=', f.owner)
      .execute(),
  ).rejects.toThrow('active send-capable owner');
  await expect(
    db
      .updateTable('mailbox_members')
      .set({ role: 'viewer' })
      .where('mailbox_id', '=', f.box)
      .where('user_id', '=', f.owner)
      .execute(),
  ).rejects.toThrow('active send-capable owner');
  await db.transaction().execute(async (tx) => {
    await tx
      .deleteFrom('mailbox_members')
      .where('mailbox_id', '=', f.box)
      .where('user_id', '=', f.owner)
      .execute();
    await tx
      .updateTable('mailboxes')
      .set({ owner_user_id: f.other })
      .where('id', '=', f.box)
      .execute();
  });
  expect(
    (
      await db
        .selectFrom('mailboxes')
        .select('owner_user_id')
        .where('id', '=', f.box)
        .executeTakeFirstOrThrow()
    ).owner_user_id,
  ).toBe(f.other);
});
it('refuses cross-company ownership even when the user belongs to another tenant', async () => {
  const f = await fixture(),
    foreign = await fixture();
  await expect(
    db
      .updateTable('mailboxes')
      .set({ owner_user_id: foreign.owner })
      .where('id', '=', f.box)
      .execute(),
  ).rejects.toThrow();
});
it('enforces effective mail.send in personal permissions and inherited profiles', async () => {
  const f = await fixture();
  await expect(
    db
      .updateTable('tenant_members')
      .set({ custom_permissions: ['mail'] })
      .where('tenant_id', '=', f.tenant)
      .where('user_id', '=', f.owner)
      .execute(),
  ).rejects.toThrow('active send-capable owner');
  const profile = await db
    .insertInto('access_profiles')
    .values({ tenant_id: f.tenant, name: 'Sender', permissions: ['mail', 'mail.send'] })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('tenant_members')
    .set({ access_profile_id: profile.id })
    .where('tenant_id', '=', f.tenant)
    .where('user_id', '=', f.owner)
    .execute();
  await expect(
    db
      .updateTable('access_profiles')
      .set({ permissions: ['mail'] })
      .where('id', '=', profile.id)
      .execute(),
  ).rejects.toThrow('active send-capable owner');
});
it('assigns live inbound to an individual owner without starting service or replacing existing assignment', async () => {
  const f = await fixture();
  await db.transaction().execute(async (tx) => {
    expect(await assignIndividualMailboxOwnerOnInbound(tx, f.thread)).toBe(true);
    expect((await recomputeThreadStatus(tx, f.thread, 'inbound', null)).to).toBe('to_reply');
  });
  let thread = await db
    .selectFrom('threads')
    .selectAll()
    .where('id', '=', f.thread)
    .executeTakeFirstOrThrow();
  expect(thread.assigned_to).toBe(f.owner);
  expect(thread.service_started_at).toBeNull();
  await db
    .updateTable('threads')
    .set({ assigned_to: f.other })
    .where('id', '=', f.thread)
    .execute();
  await db
    .transaction()
    .execute(async (tx) =>
      expect(await assignIndividualMailboxOwnerOnInbound(tx, f.thread)).toBe(false),
    );
  thread = await db
    .selectFrom('threads')
    .selectAll()
    .where('id', '=', f.thread)
    .executeTakeFirstOrThrow();
  expect(thread.assigned_to).toBe(f.other);
  const global = await fixture(false);
  await db
    .transaction()
    .execute(async (tx) =>
      expect(await assignIndividualMailboxOwnerOnInbound(tx, global.thread)).toBe(false),
    );
});
it('starts service explicitly with hidden queues, keeps the responsible person and starts idempotently', async () => {
  const f = await fixture();
  await db
    .updateTable('threads')
    .set({ assigned_to: f.other })
    .where('id', '=', f.thread)
    .execute();
  await db
    .transaction()
    .execute(async (tx) =>
      expect((await startThreadService(tx, f.thread, f.owner)).to).toBe('in_progress'),
    );
  const first = await db
    .selectFrom('threads')
    .selectAll()
    .where('id', '=', f.thread)
    .executeTakeFirstOrThrow();
  await db.transaction().execute(async (tx) => startThreadService(tx, f.thread, f.owner));
  const second = await db
    .selectFrom('threads')
    .selectAll()
    .where('id', '=', f.thread)
    .executeTakeFirstOrThrow();
  expect(second.service_started_at).toEqual(first.service_started_at);
  expect(second.assigned_to).toBe(f.other);
});
it('a genuinely newer inbound opens a fresh service round while repeat aggregate refresh preserves progress', async () => {
  const f = await fixture();
  const initial = new Date('2026-01-01'),
    started = new Date('2026-01-02'),
    later = new Date('2026-01-03');
  await db
    .insertInto('messages')
    .values({
      tenant_id: f.tenant,
      mailbox_id: f.box,
      thread_id: f.thread,
      message_at: initial,
      message_id_header: '<' + randomUUID() + '>',
      direction: 'inbound',
      to_addresses: asJson([]),
    })
    .execute();
  await db
    .updateTable('threads')
    .set({ assigned_to: f.owner, service_started_at: started })
    .where('id', '=', f.thread)
    .execute();
  await db.transaction().execute(async (tx) => {
    await refreshThreadAggregates(tx, f.thread);
    expect((await recomputeThreadStatus(tx, f.thread, 'sync', null)).to).toBe('in_progress');
  });
  await db
    .insertInto('messages')
    .values({
      tenant_id: f.tenant,
      mailbox_id: f.box,
      thread_id: f.thread,
      message_at: later,
      message_id_header: '<' + randomUUID() + '>',
      direction: 'inbound',
      to_addresses: asJson([]),
    })
    .execute();
  await db.transaction().execute(async (tx) => {
    await refreshThreadAggregates(tx, f.thread);
    expect((await recomputeThreadStatus(tx, f.thread, 'inbound', null)).to).toBe('to_reply');
  });
  const current = await db
    .selectFrom('threads')
    .selectAll()
    .where('id', '=', f.thread)
    .executeTakeFirstOrThrow();
  expect(current.assigned_to).toBe(f.owner);
  expect(current.service_started_at).toBeNull();
});
