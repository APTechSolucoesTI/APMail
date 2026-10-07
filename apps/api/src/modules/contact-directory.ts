import type { FastifyInstance } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { asJson, audit, lockStorageTenant, type DB } from '@apmail/db';
import { contactSchema, contactPhoneSchema, emailSchema, normalizeRuleText } from '@apmail/shared';
import {
  requireTenant,
  requireCapability,
  notFound,
  conflict,
  ApiError,
  type RequestContext,
} from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import { readableFolders, folderPredicate } from '../authz/folders.js';
import { companySearch } from './companies.js';
import type { Resources } from './resources.js';
type Database = Kysely<DB> | Transaction<DB>;
type Context = ReturnType<typeof requireTenant>;
export const contactVisible = (c: Context) => sql<boolean>`contacts.tenant_id=${c.tenantId}`;
export function contactNickname(c: Context) {
  return sql<string>`coalesce((select n.nickname from contact_user_nicknames n where n.tenant_id=contacts.tenant_id and n.contact_id=contacts.id and n.user_id=${c.userId}),'')`;
}
export function contactSearch(search: string, c: Context) {
  const pattern = '%' + normalizeRuleText(search).replace(/[%_\\]/g, '\\$&') + '%';
  const digits = search.replace(/\D/g, '');
  return sql<boolean>`(lower(unaccent(regexp_replace(concat_ws(' ',contacts.name,contacts.job_title,contacts.phone,contacts.phones::text,${contactNickname(c)}),'\\s+',' ','g'))) like ${pattern}
    or exists(select 1 from contact_emails e where e.tenant_id=contacts.tenant_id and e.contact_id=contacts.id and e.email ilike ${pattern})
    or exists(select 1 from contact_company_links l join contact_companies cc on cc.id=l.company_id and cc.tenant_id=l.tenant_id where l.tenant_id=contacts.tenant_id and l.contact_id=contacts.id and ${companySearch(search)})
    or (${digits.length >= 2 && /^[\d\s()+.\-/]+$/.test(search)} and exists(select 1 from jsonb_array_elements(contacts.phones) p where regexp_replace(p->>'number','[^0-9]','','g') like ${'%' + digits + '%'})))`;
}
export async function readContact(db: Database, c: Context, id: string) {
  const contact = await db
    .selectFrom('contacts')
    .select(['id', 'name', 'phone', 'phones', 'job_title', 'notes', 'created_at', 'updated_at'])
    .select(contactNickname(c).as('nickname'))
    .where('tenant_id', '=', c.tenantId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!contact) throw notFound();
  const emails = await db
    .selectFrom('contact_emails')
    .select(['email', 'is_primary'])
    .where('tenant_id', '=', c.tenantId)
    .where('contact_id', '=', id)
    .orderBy('is_primary', 'desc')
    .orderBy('email')
    .execute();
  const companies = await db
    .selectFrom('contact_company_links as l')
    .innerJoin('contact_companies as cc', (j) =>
      j.onRef('cc.id', '=', 'l.company_id').onRef('cc.tenant_id', '=', 'l.tenant_id'),
    )
    .select(['cc.id', 'cc.name', 'cc.trade_name', 'cc.cnpj', 'cc.addresses', 'l.is_primary'])
    .where('l.tenant_id', '=', c.tenantId)
    .where('l.contact_id', '=', id)
    .orderBy('l.is_primary', 'desc')
    .orderBy('cc.name')
    .execute();
  return {
    ...contact,
    phones: z.array(contactPhoneSchema).parse(contact.phones),
    emails: emails.map((e) => ({ ...e, label: '', links: [] })),
    companies: companies.map((company) => ({ ...company, cnpj: company.cnpj ?? '' })),
  };
}
async function nickname(db: Database, c: Context, id: string, value: string) {
  if (!value)
    return db
      .deleteFrom('contact_user_nicknames')
      .where('tenant_id', '=', c.tenantId)
      .where('contact_id', '=', id)
      .where('user_id', '=', c.userId)
      .execute();
  await db
    .insertInto('contact_user_nicknames')
    .values({ tenant_id: c.tenantId, contact_id: id, user_id: c.userId, nickname: value })
    .onConflict((oc) => oc.columns(['contact_id', 'user_id']).doUpdateSet({ nickname: value }))
    .execute();
}
export async function registerContactDirectory(app: FastifyInstance, r: Resources) {
  const idOf = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
  app.get('/api/contacts/companies', async (req) => {
    const c = requireTenant(req.ctx),
      q = z.object({ search: z.string().trim().max(200).default('') }).parse(req.query);
    const items = await r.db
      .selectFrom('contact_companies as cc')
      .selectAll('cc')
      .where('cc.tenant_id', '=', c.tenantId)
      .where(companySearch(q.search))
      .orderBy('cc.name')
      .limit(50)
      .execute();
    return { items: items.map((company) => ({ ...company, cnpj: company.cnpj ?? '' })) };
  });
  app.get('/api/contacts', async (req) => {
    const c = requireTenant(req.ctx),
      q = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce
            .number()
            .int()
            .refine((n) => [10, 20, 30, 50, 100].includes(n))
            .default(10),
          search: z.string().trim().max(200).default(''),
          email: emailSchema.optional(),
          mailbox_id: z.uuid().optional(),
          sort: z.enum(['name', 'created_at']).default('name'),
          direction: z.enum(['asc', 'desc']).default('asc'),
        })
        .parse(req.query);
    if (q.mailbox_id) await requireMailboxPerm(c, r.db, q.mailbox_id, 'read');
    let base = r.db.selectFrom('contacts').where('contacts.tenant_id', '=', c.tenantId);
    if (q.search) base = base.where(contactSearch(q.search, c));
    if (q.email)
      base = base.where(
        sql<boolean>`exists(select 1 from contact_emails e where e.tenant_id=contacts.tenant_id and e.contact_id=contacts.id and e.email=${q.email})`,
      );
    const total = Number(
      (await base.select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n,
    );
    const items = await base
      .select([
        'contacts.id',
        'contacts.name',
        'contacts.phone',
        'contacts.job_title',
        'contacts.created_at',
      ])
      .select([
        contactNickname(c).as('nickname'),
        sql<
          string | null
        >`(select cc.name from contact_company_links l join contact_companies cc on cc.id=l.company_id and cc.tenant_id=l.tenant_id where l.contact_id=contacts.id and l.tenant_id=contacts.tenant_id and l.is_primary limit 1)`.as(
          'primary_company',
        ),
        sql<
          string | null
        >`(select e.email from contact_emails e where e.contact_id=contacts.id and e.tenant_id=contacts.tenant_id and e.is_primary limit 1)`.as(
          'primary_email',
        ),
        sql<
          string[]
        >`array(select e.email from contact_emails e where e.contact_id=contacts.id and e.tenant_id=contacts.tenant_id order by e.is_primary desc,e.email)`.as(
          'emails',
        ),
      ])
      .orderBy(`contacts.${q.sort}`, q.direction)
      .orderBy('contacts.id')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
  app.get('/api/contacts/:id', (req) =>
    readContact(r.db, requireTenant(req.ctx), idOf(req.params)),
  );
  app.patch('/api/contacts/:id/nickname', async (req) => {
    const c = requireTenant(req.ctx),
      id = idOf(req.params),
      b = z
        .object({ nickname: z.string().trim().max(120) })
        .strict()
        .parse(req.body);
    await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      await readContact(tx, c, id);
      await nickname(tx, c, id, b.nickname);
    });
    r.io.to('user:' + c.userId).emit('directory:changed', {});
    return { nickname: b.nickname };
  });
  async function save(ctx: RequestContext | null, id: string | null, body: unknown) {
    const c = requireTenant(ctx),
      b = contactSchema.parse(body);
    if (b.emails.some((e) => e.links.length))
      throw new ApiError(
        400,
        'obsolete_contact_relationship',
        'Vincule as empresas diretamente ao contato.',
      );
    const companies = b.companies;
    if (
      companies.some((company) => !company.id) ||
      new Set(companies.map((company) => company.id)).size !== companies.length
    )
      throw new ApiError(
        400,
        'validation_error',
        'Selecione empresas cadastradas, sem repetir vínculos.',
      );
    const phones = b.phones ?? (b.phone ? [{ number: b.phone, label: '', is_primary: true }] : []);
    if (phones.length && !phones.some((p) => p.is_primary)) phones[0]!.is_primary = true;
    if (!b.emails.some((e) => e.is_primary)) b.emails[0]!.is_primary = true;
    if (companies.length && !companies.some((company) => company.is_primary))
      companies[0]!.is_primary = true;
    const contactId = await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      if (id) await readContact(tx, c, id);
      if (companies.length) {
        const known = await tx
          .selectFrom('contact_companies')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where(
            'id',
            'in',
            companies.map((company) => company.id!),
          )
          .execute();
        if (known.length !== companies.length) throw notFound();
      }
      const duplicate = await tx
        .selectFrom('contact_emails')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where(
          'email',
          'in',
          b.emails.map((e) => e.email),
        )
        .$if(!!id, (q) => q.where('contact_id', '!=', id!))
        .executeTakeFirst();
      if (duplicate) throw conflict('Um dos e-mails já pertence a outro contato desta empresa.');
      const values = {
        name: b.name,
        phone: phones.find((p) => p.is_primary)?.number ?? '',
        phones: asJson(phones),
        job_title: b.job_title ?? '',
        notes: b.notes,
        updated_at: new Date(),
      };
      const row = id
        ? await tx
            .updateTable('contacts')
            .set(values)
            .where('id', '=', id)
            .where('tenant_id', '=', c.tenantId)
            .returning('id')
            .executeTakeFirstOrThrow()
        : await tx
            .insertInto('contacts')
            .values({ ...values, tenant_id: c.tenantId, created_by: c.userId })
            .returning('id')
            .executeTakeFirstOrThrow();
      // Delete projections before replacements so unchanged content is not charged twice.
      await tx
        .deleteFrom('contact_emails')
        .where('tenant_id', '=', c.tenantId)
        .where('contact_id', '=', row.id)
        .execute();
      await tx
        .deleteFrom('contact_company_links')
        .where('tenant_id', '=', c.tenantId)
        .where('contact_id', '=', row.id)
        .execute();
      await tx
        .insertInto('contact_emails')
        .values(
          b.emails.map((e) => ({
            tenant_id: c.tenantId,
            contact_id: row.id,
            email: e.email,
            is_primary: e.is_primary ?? false,
          })),
        )
        .execute();
      if (companies.length)
        await tx
          .insertInto('contact_company_links')
          .values(
            companies.map((company) => ({
              tenant_id: c.tenantId,
              contact_id: row.id,
              company_id: company.id!,
              is_primary: company.is_primary ?? false,
            })),
          )
          .execute();
      if (b.nickname !== undefined) await nickname(tx, c, row.id, b.nickname);
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: id ? 'contact.updated' : 'contact.created',
        entityType: 'contact',
        entityId: row.id,
        metadata: { email_count: b.emails.length },
        ip: c.ip,
      });
      return row.id;
    });
    r.io.to('tenant:' + c.tenantId).emit('directory:changed', {});
    return { id: contactId };
  }
  app.post('/api/contacts', async (req, res) =>
    res.code(201).send(await save(req.ctx, null, req.body)),
  );
  app.put('/api/contacts/:id', (req) => save(req.ctx, idOf(req.params), req.body));
  app.delete('/api/contacts/:id', async (req) => {
    const c = requireCapability(req.ctx, 'contacts_manage'),
      id = idOf(req.params);
    await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      await readContact(tx, c, id);
      await tx
        .deleteFrom('contacts')
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'contact.deleted',
        entityType: 'contact',
        entityId: id,
        ip: c.ip,
      });
    });
    r.io.to('tenant:' + c.tenantId).emit('directory:changed', {});
    return { ok: true };
  });
  app.get('/api/contacts/:id/history', async (req) => {
    const c = requireTenant(req.ctx),
      contact = await readContact(r.db, c, idOf(req.params));
    const q = z
      .object({
        email: emailSchema.optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce
          .number()
          .int()
          .refine((n) => [10, 20, 30, 50, 100].includes(n))
          .default(10),
      })
      .parse(req.query);
    const emails = q.email ? [q.email] : contact.emails.map((e) => e.email);
    if (q.email && !contact.emails.some((e) => e.email === q.email)) throw notFound();
    const boxes = await r.db
      .selectFrom('mailboxes')
      .select(['id', 'name'])
      .where('tenant_id', '=', c.tenantId)
      .where('deleted_at', 'is', null)
      .execute();
    const grants = [];
    for (const box of boxes) {
      try {
        const scope = await readableFolders(c, r.db, box.id);
        grants.push(sql`(m.mailbox_id=${box.id} and ${folderPredicate(scope)})`);
      } catch (error) {
        if (!(error instanceof ApiError && [403, 404].includes(error.statusCode))) throw error;
      }
    }
    if (!grants.length) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
    const conditions = sql<boolean>`m.tenant_id=${c.tenantId} and m.deleted_at is null and (${sql.join(grants, sql` or `)}) and (lower(m.from_address)=any(${emails}::text[]) or exists(select 1 from jsonb_array_elements(m.to_addresses||m.cc_addresses) a where lower(a->>'address')=any(${emails}::text[])))`;
    const result = await sql<{
      items: unknown[];
      total: number;
    }>`with matched as (select distinct on (m.thread_id) m.thread_id,m.mailbox_id,m.subject,m.message_at,b.name as mailbox_name from messages m join mailboxes b on b.id=m.mailbox_id join threads t on t.id=m.thread_id and t.tenant_id=m.tenant_id where ${conditions} and t.deleted_at is null order by m.thread_id,m.message_at desc,m.id), paged as (select * from matched order by message_at desc,thread_id limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}) select coalesce((select jsonb_agg(p order by message_at desc,thread_id) from paged p),'[]') as items,(select count(*)::int from matched) as total`.execute(
      r.db,
    );
    return { ...result.rows[0], page: q.page, pageSize: q.pageSize };
  });
}
