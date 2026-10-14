import { sql } from 'kysely';
import { z } from 'zod';
import { isTenantAdmin, type Address } from '@apmail/shared';
import type { Resources } from './resources.js';
import type { RequestContext } from '../authz/context.js';
import { requireTenant } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import { readableFolders, folderPredicate } from '../authz/folders.js';
import { contactSearch, contactNickname, contactVisible } from './contact-directory.js';
type Suggestion = Address & {
  source: 'mailbox' | 'user' | 'history' | 'contact';
  nickname?: string;
  company_name?: string;
};
export async function addressSuggestions(
  r: Resources,
  context: RequestContext | null,
  mailboxId: string,
  query: unknown,
) {
  const c = requireTenant(context);
  await requireMailboxPerm(c, r.db, mailboxId, 'read');
  const { q } = z.object({ q: z.string().trim().max(100).default('') }).parse(query);
  if (q.length < 2) return [];
  const pattern = '%' + q.replace(/[\\%_]/g, '\\$&') + '%';
  const boxes = await r.db
    .selectFrom('mailboxes as b')
    .select(['b.id', 'b.name', 'b.email_address', 'b.aliases'])
    .where('b.tenant_id', '=', c.tenantId)
    .where('b.deleted_at', 'is', null)
    .$if(!isTenantAdmin(c.tenantRole), (qb) =>
      qb.where((eb) =>
        eb.exists(
          eb
            .selectFrom('mailbox_members as mm')
            .select('mm.user_id')
            .whereRef('mm.mailbox_id', '=', 'b.id')
            .where('mm.tenant_id', '=', c.tenantId)
            .where('mm.user_id', '=', c.userId),
        ),
      ),
    )
    .execute();
  const scopes = await Promise.all(
    boxes.map(
      async (box) =>
        sql`(m.mailbox_id=${box.id} and ${folderPredicate(await readableFolders(c, r.db, box.id))})`,
    ),
  );
  const visible = scopes.length ? sql.join(scopes, sql` or `) : sql`false`;
  const history =
    await sql<Address>`select distinct on(lower(address)) lower(address) as address,name from (
    select m.from_address as address,m.from_name as name,m.message_at from messages m
      where m.tenant_id=${c.tenantId} and m.deleted_at is null and (${visible})
      and (unaccent(m.from_address) ilike unaccent(${pattern}) or unaccent(m.from_name) ilike unaccent(${pattern}))
    union all select a->>'address',coalesce(a->>'name',''),m.message_at from messages m
      cross join lateral jsonb_array_elements(m.to_addresses||m.cc_addresses||m.bcc_addresses) a
      where m.tenant_id=${c.tenantId} and m.deleted_at is null and (${visible})
      and (unaccent(a->>'address') ilike unaccent(${pattern}) or unaccent(a->>'name') ilike unaccent(${pattern}))
    ) entries where address<>'' order by lower(address),message_at desc limit 20`.execute(r.db);
  const users =
    await sql<Address>`select u.email as address,u.full_name as name from users u join tenant_members tm on tm.user_id=u.id
    where tm.tenant_id=${c.tenantId} and tm.status='active' and not exists(select 1 from platform_admins p where p.user_id=u.id)
    and (unaccent(u.email) ilike unaccent(${pattern}) or unaccent(u.full_name) ilike unaccent(${pattern})) order by u.full_name,u.id limit 20`.execute(
      r.db,
    );
  const contacts = await sql<
    Address & { nickname: string; company_name: string }
  >`select e.email as address,contacts.name,${contactNickname(c)} as nickname,contacts.company as company_name
    from contacts join contact_emails e on e.contact_id=contacts.id and e.tenant_id=contacts.tenant_id
    where ${contactVisible(c)} and ${contactSearch(q, c)} order by contacts.name,e.is_primary desc,e.email limit 20`.execute(
    r.db,
  );
  const candidates: Suggestion[] = [
    ...contacts.rows.map((row) => ({ ...row, source: 'contact' as const })),
    ...boxes.flatMap((box) =>
      [box.email_address, ...box.aliases].map((address) => ({
        address,
        name: box.name,
        source: 'mailbox' as const,
      })),
    ),
    ...users.rows.map((row) => ({ ...row, source: 'user' as const })),
    ...history.rows.map((row) => ({ ...row, source: 'history' as const })),
  ];
  const normalized = (text: string) =>
    text
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .toLocaleLowerCase('pt-BR');
  const term = normalized(q),
    unique = new Map<string, Suggestion>();
  for (const candidate of candidates) {
    const address = candidate.address.trim().toLowerCase();
    if (
      !z.email().safeParse(address).success ||
      !normalized(
        [address, candidate.name, candidate.nickname, candidate.company_name]
          .filter(Boolean)
          .join(' '),
      ).includes(term)
    )
      continue;
    if (!unique.has(address)) unique.set(address, { ...candidate, address });
  }
  return [...unique.values()]
    .sort(
      (a, b) =>
        Number(!a.address.startsWith(q.toLowerCase())) -
          Number(!b.address.startsWith(q.toLowerCase())) ||
        a.name.localeCompare(b.name, 'pt-BR') ||
        a.address.localeCompare(b.address),
    )
    .slice(0, 20);
}
