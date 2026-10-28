import { domainToUnicode } from 'node:url';
import { normalizeDomain } from '@apmail/shared';
import type { Database } from './threads.js';
export async function ensureMailboxDomain(
  db: Database,
  tenantId: string,
  value: string,
  actorId: string | null,
) {
  const domain = normalizeDomain(value);
  return db
    .insertInto('tenant_domains')
    .values({
      tenant_id: tenantId,
      domain,
      display_name: domainToUnicode(domain),
      created_by: actorId,
    })
    .onConflict((oc) => oc.columns(['tenant_id', 'domain']).doUpdateSet({ domain }))
    .returning(['id', 'domain', 'display_name'])
    .executeTakeFirstOrThrow();
}

/** Fills only missing metadata, including IDNA addresses that SQL cannot normalize. */
export async function backfillMailboxDomains(db: Database) {
  let after = '00000000-0000-0000-0000-000000000000';
  for (;;) {
    const boxes = await db
      .selectFrom('mailboxes')
      .select(['id', 'tenant_id', 'email_address'])
      .where('domain_id', 'is', null)
      .where('id', '>', after)
      .orderBy('id')
      .limit(500)
      .execute();
    if (!boxes.length) return;
    for (const box of boxes) {
      const name = box.email_address.split('@')[1];
      if (!name) continue;
      try {
        normalizeDomain(name);
      } catch {
        continue;
      }
      await db.transaction().execute(async (tx) => {
        const domain = await ensureMailboxDomain(tx, box.tenant_id, name, null);
        await tx
          .updateTable('mailboxes')
          .set({ domain_id: domain.id })
          .where('id', '=', box.id)
          .where('tenant_id', '=', box.tenant_id)
          .where('domain_id', 'is', null)
          .execute();
      });
    }
    after = boxes.at(-1)!.id;
  }
}
