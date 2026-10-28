import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb } from '../../src/client.js';
import { migrate } from '../../src/migrate.js';
import { resolveThread, type ThreadMessage } from '../../src/domain/threads.js';
const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Dedicated test database required');
const db = createDb(url),
  tenant = randomUUID(),
  box = randomUUID();
beforeAll(async () => {
  await migrate(url);
  await db.insertInto('tenants').values({ id: tenant, name: 'Thread QA', slug: tenant }).execute();
  await db
    .insertInto('mailboxes')
    .values({
      id: box,
      tenant_id: tenant,
      name: 'QA',
      email_address: 'box@example.test',
      username: 'qa',
      imap_host: 'localhost',
      smtp_host: 'localhost',
    })
    .execute();
});
afterAll(async () => db.destroy());
function msg(id: string, parent: string | null = null, refs: string[] = []) {
  return {
    tenant_id: tenant,
    mailbox_id: box,
    subject: 'Mesmo assunto',
    message_at: new Date(),
    message_id_header: id,
    in_reply_to: parent,
    references_headers: refs,
    from_address: 'person@example.test',
    to_addresses: [],
    cc_addresses: [],
  } satisfies ThreadMessage & { message_id_header: string };
}
const resolve = (m: ReturnType<typeof msg>) =>
  db.transaction().execute((tx) => resolveThread(tx, m, ['box@example.test']));
it('keeps independent same-subject emails separate without a completion action', async () => {
  const a = await resolve(msg('<new-a@test>'));
  await db
    .updateTable('threads')
    .set({ last_message_at: new Date() })
    .where('id', '=', a)
    .execute();
  expect(await resolve(msg('<new-b@test>'))).not.toBe(a);
});
it('resolves child before parent and siblings by explicit message identities', async () => {
  const child = await resolve(msg('<child@test>', '<parent@test>', ['<parent@test>']));
  expect(await resolve(msg('<parent@test>'))).toBe(child);
  expect(await resolve(msg('<sibling@test>', '<parent@test>'))).toBe(child);
});
it('deduplicates concurrent replies by parent identity', async () => {
  const ids = await Promise.all([
    resolve(msg('<c1@test>', '<future@test>')),
    resolve(msg('<c2@test>', '<future@test>')),
  ]);
  expect(ids[0]).toBe(ids[1]);
});
it('allows explicit mailbox purge to remove unused message identities', async () => {
  const thread = await resolve(msg('<purge-identity@test>'));
  await db.deleteFrom('threads').where('id', '=', thread).execute();
  expect(
    await db
      .selectFrom('thread_message_identities')
      .select('thread_id')
      .where('thread_id', '=', thread)
      .execute(),
  ).toHaveLength(0);
});
