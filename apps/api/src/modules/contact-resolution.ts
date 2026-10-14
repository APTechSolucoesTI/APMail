import { sql, type Kysely, type Transaction, type RawBuilder } from 'kysely';
import { type DB } from '@apmail/db';
import {
  normalizeContactEmail,
  type ContactIdentity,
  type ContactResolution,
} from '@apmail/shared';
import type { RequestContext } from '../authz/context.js';
import { requireTenant } from '../authz/context.js';
import { contactVisible } from './contact-directory.js';
export function contactIdentitySql(context: RequestContext, address: RawBuilder<unknown>) {
  const c = requireTenant(context);
  return sql<
    string | null
  >`(select contacts.name from contacts join contact_emails e on e.contact_id=contacts.id and e.tenant_id=contacts.tenant_id
    where ${contactVisible(c)} and lower(btrim(e.email))=lower(btrim(${address})) order by (contacts.scope='personal') desc,contacts.id limit 1)`;
}

/** One indexed query per batch. A user's personal agenda wins over the global agenda. */
export async function resolveContacts(
  db: Kysely<DB> | Transaction<DB>,
  context: RequestContext,
  values: string[],
): Promise<ContactResolution> {
  const c = requireTenant(context);
  const emails = [...new Set(values.map(normalizeContactEmail).filter((v): v is string => !!v))];
  if (!emails.length) return {};
  const rows = await sql<
    ContactIdentity & { email: string }
  >`select distinct on(lower(btrim(e.email)))
    lower(btrim(e.email)) as email,contacts.id,contacts.name,contacts.scope
    from contacts join contact_emails e on e.contact_id=contacts.id and e.tenant_id=contacts.tenant_id
    where ${contactVisible(c)} and lower(btrim(e.email))=any(${emails}::text[])
    order by lower(btrim(e.email)),(contacts.scope='personal') desc,contacts.id`.execute(db);
  return Object.fromEntries(rows.rows.map(({ email, ...identity }) => [email, identity]));
}
