import type { Kysely } from 'kysely';
import type { DB } from '../types.js';
import { encryptSecret, decryptSecret } from '../crypto.js';
export async function writeMailboxCredential(
  db: Kysely<DB>,
  tenantId: string,
  mailboxId: string,
  password: string,
  key: string,
) {
  await db
    .insertInto('mailbox_credentials')
    .values({
      tenant_id: tenantId,
      mailbox_id: mailboxId,
      encrypted_password: encryptSecret(password, key),
    })
    .onConflict((oc) =>
      oc.column('mailbox_id').doUpdateSet({ encrypted_password: encryptSecret(password, key) }),
    )
    .execute();
}
// Uso interno do worker; a API nunca lê esta tabela.
export async function readMailboxCredential(
  db: Kysely<DB>,
  tenantId: string,
  mailboxId: string,
  key: string,
) {
  const row = await db
    .selectFrom('mailbox_credentials')
    .select('encrypted_password')
    .where('tenant_id', '=', tenantId)
    .where('mailbox_id', '=', mailboxId)
    .executeTakeFirstOrThrow();
  return decryptSecret(row.encrypted_password, key);
}
