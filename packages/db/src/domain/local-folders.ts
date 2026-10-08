import type { Kysely } from 'kysely';
import type { DB } from '../types.js';
export async function ensureLocalFolders(db: Kysely<DB>, tenant: string, mailbox: string) {
  for (const [name, use] of [
    ['Caixa de entrada', 'inbox'],
    ['Enviados', 'sent'],
    ['Rascunhos', 'drafts'],
    ['Lixeira', 'trash'],
    ['Spam', 'junk'],
  ] as const) {
    await db
      .insertInto('folders')
      .values({
        tenant_id: tenant,
        mailbox_id: mailbox,
        name,
        special_use: use,
        imap_path: 'local/' + use,
        is_local: true,
        special_use_official: true,
      })
      .onConflict((oc) =>
        oc.columns(['mailbox_id', 'imap_path']).where('deleted_at', 'is', null).doNothing(),
      )
      .execute();
  }
  return db
    .selectFrom('folders')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .where('mailbox_id', '=', mailbox)
    .where('special_use', '=', 'inbox')
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
}
