import { beforeAll, afterAll, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createDb } from '../../src/client.js';
import { migrate } from '../../src/migrate.js';
import { ensureLocalFolders } from '../../src/domain/local-folders.js';
import {
  createArchiveFolderResolver,
  reorganizeArchiveFolders,
} from '../../src/domain/archive-folders.js';

const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Dedicated test database required');
const db = createDb(url),
  tenant = randomUUID(),
  foreign = randomUUID();
beforeAll(async () => {
  await migrate(url);
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Archive folders QA', slug: tenant },
      { id: foreign, name: 'Other QA', slug: foreign },
    ])
    .execute();
}, 30000);
afterAll(async () => db.destroy());
async function box(protocol: 'local' | 'pop3' | 'imap' = 'pop3') {
  const row = await db
    .insertInto('mailboxes')
    .values({
      tenant_id: tenant,
      name: 'Folder QA',
      email_address: randomUUID() + '@example.test',
      receiving_protocol: protocol,
      username: 'qa',
      imap_host: 'localhost',
      smtp_host: 'localhost',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  if (protocol !== 'imap') await ensureLocalFolders(db, tenant, row.id);
  return row;
}
const prefix = 'Importados/Início do arquivo de dados do Outlook/';
it('maps direct standard folders, strips only known wrappers, preserves custom hierarchy and reuses destinations', async () => {
  const mailbox = await box(),
    resolve = await createArchiveFolderResolver(db, mailbox);
  const inbox = await resolve(prefix + 'Caixa de Entrada');
  expect(inbox.special_use).toBe('inbox');
  expect(inbox.imap_path).toBe('local/inbox');
  expect((await resolve(prefix + 'Itens Enviados')).special_use).toBe('sent');
  expect((await resolve(prefix + 'Itens Excluídos')).special_use).toBe('trash');
  expect((await resolve(prefix + 'Lixo Eletrônico')).special_use).toBe('junk');
  expect((await resolve(prefix + 'Rascunhos')).special_use).toBe('drafts');
  const child = await resolve(prefix + 'Caixa de Entrada/Clientes/Enviados');
  expect(child.special_use).toBeNull();
  const parent = await resolve(prefix + 'Caixa de Entrada/Clientes');
  expect(child.parent_id).toBe(parent.id);
  expect(parent.parent_id).toBe(inbox.id);
  expect((await resolve(prefix + 'Caixa de Entrada/Clientes/Enviados')).id).toBe(child.id);
  expect((await resolve(prefix + 'Projeto/Sent Items')).special_use).toBeNull();
  expect((await resolve('qa.eml', undefined, 'eml')).id).toBe(inbox.id);
});
it('keeps standalone imports isolated and uses an IMAP official folder without changing its provider identity', async () => {
  const standalone = await box('local'),
    resolve = await createArchiveFolderResolver(db, standalone);
  expect((await resolve(prefix + 'Caixa de Entrada')).imap_path).toBe(
    'local/importados/' + prefix + 'Caixa de Entrada',
  );
  const imap = await box('imap');
  const native = await db
    .insertInto('folders')
    .values({
      tenant_id: tenant,
      mailbox_id: imap.id,
      name: 'INBOX',
      imap_path: 'INBOX',
      special_use: 'inbox',
      special_use_official: true,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const direct = await createArchiveFolderResolver(db, imap);
  expect((await direct(prefix + 'Inbox')).id).toBe(native.id);
  const child = await direct(prefix + 'Inbox/Contracts');
  expect(child.parent_id).toBe(native.id);
  expect(child.is_local).toBe(true);
  expect(
    (
      await db
        .selectFrom('folders')
        .selectAll()
        .where('id', '=', native.id)
        .executeTakeFirstOrThrow()
    ).imap_path,
  ).toBe('INBOX');
});
it('reorganizes legacy mail without changing message IDs, raw files or custom folder IDs; is tenant scoped and idempotent', async () => {
  const mailbox = await box();
  const legacy = await createArchiveFolderResolver(db, { ...mailbox, receiving_protocol: 'local' });
  const source = await legacy(prefix + 'Caixa de Entrada'),
    custom = await legacy(prefix + 'Caixa de Entrada/Clientes');
  const thread = await db
    .insertInto('threads')
    .values({ tenant_id: tenant, mailbox_id: mailbox.id, subject: 'Existing mail' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const message = await db
    .insertInto('messages')
    .values({
      tenant_id: tenant,
      mailbox_id: mailbox.id,
      thread_id: thread.id,
      folder_id: source.id,
      source_kind: 'archive',
      source_key: 'stable-key',
      message_id_header: '<existing@example.test>',
      from_address: 'sender@example.test',
      message_at: new Date(),
      raw_storage_path: 'mail-raw/fixture.eml',
      is_historical: true,
      direction: 'inbound',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await expect(
    db.transaction().execute((tx) => reorganizeArchiveFolders(tx, foreign, mailbox.id)),
  ).rejects.toThrow();
  const result = await db
    .transaction()
    .execute((tx) => reorganizeArchiveFolders(tx, tenant, mailbox.id));
  expect(result.movedMessages).toBe(1);
  const saved = await db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', message.id)
    .executeTakeFirstOrThrow();
  expect(saved).toMatchObject({
    id: message.id,
    source_key: 'stable-key',
    raw_storage_path: 'mail-raw/fixture.eml',
    rules_inbox: true,
    deleted_at: null,
  });
  const inbox = await db
    .selectFrom('folders')
    .selectAll()
    .where('id', '=', saved.folder_id!)
    .executeTakeFirstOrThrow();
  expect(inbox.special_use).toBe('inbox');
  expect(
    await db
      .selectFrom('folders')
      .selectAll()
      .where('id', '=', custom.id)
      .executeTakeFirstOrThrow(),
  ).toMatchObject({ parent_id: inbox.id, deleted_at: null });
  expect(
    await db
      .selectFrom('folders')
      .select('id')
      .where('mailbox_id', '=', mailbox.id)
      .where('imap_path', 'like', 'local/importados%')
      .where('deleted_at', 'is', null)
      .execute(),
  ).toHaveLength(0);
  expect(
    (await db.transaction().execute((tx) => reorganizeArchiveFolders(tx, tenant, mailbox.id)))
      .movedMessages,
  ).toBe(0);
});

it('rolls back merges that would broaden restricted folder permissions', async () => {
  const mailbox = await box(),
    user = randomUUID();
  await db
    .insertInto('users')
    .values({
      id: user,
      email: user + '@example.test',
      full_name: 'Restricted QA',
      password_hash: 'fixture',
    })
    .execute();
  await db
    .insertInto('tenant_members')
    .values({ tenant_id: tenant, user_id: user, role: 'member' })
    .execute();
  await db
    .insertInto('mailbox_members')
    .values({
      tenant_id: tenant,
      mailbox_id: mailbox.id,
      user_id: user,
      role: 'viewer',
      restrict_to_folders: true,
    })
    .execute();
  const legacy = await createArchiveFolderResolver(db, { ...mailbox, receiving_protocol: 'local' });
  const source = await legacy(prefix + 'Caixa de Entrada');
  await db
    .insertInto('folder_permissions')
    .values({ tenant_id: tenant, mailbox_id: mailbox.id, user_id: user, folder_id: source.id })
    .execute();
  await expect(
    db.transaction().execute((tx) => reorganizeArchiveFolders(tx, tenant, mailbox.id)),
  ).rejects.toThrow('permissões restritas');
  expect(
    await db
      .selectFrom('folders')
      .select(['imap_path', 'deleted_at'])
      .where('id', '=', source.id)
      .executeTakeFirstOrThrow(),
  ).toEqual({ imap_path: source.imap_path, deleted_at: null });
  expect(
    await db
      .selectFrom('folder_permissions')
      .select('folder_id')
      .where('user_id', '=', user)
      .execute(),
  ).toEqual([{ folder_id: source.id }]);
});
