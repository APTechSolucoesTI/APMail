import type { FastifyInstance } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { audit, asJson, lockStorageTenant, type DB } from '@apmail/db';
import {
  contactSchema,
  isTenantAdmin,
  canDelegate,
  normalizeRuleText,
  emailSchema,
  contactPhoneSchema,
} from '@apmail/shared';
import {
  requireTenant,
  requireCapability,
  forbidden,
  notFound,
  ApiError,
  conflict,
  type RequestContext,
} from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from './resources.js';
type Database = Kysely<DB> | Transaction<DB>;
const idOf = (p: unknown) => z.object({ id: z.uuid() }).parse(p).id;
// Visibility is the intersection with actual mailbox access, not the sender address.
export function contactVisible(c: ReturnType<typeof requireTenant>) {
  return sql<boolean>`exists(select 1 from mailboxes b where b.tenant_id=${c.tenantId} and b.deleted_at is null
    and (${isTenantAdmin(c.tenantRole)} or exists(select 1 from mailbox_members mm where mm.tenant_id=b.tenant_id and mm.mailbox_id=b.id and mm.user_id=${c.userId}))
    and (contacts.visibility='all' or exists(select 1 from contact_mailboxes cm where cm.tenant_id=contacts.tenant_id and cm.contact_id=contacts.id and cm.mailbox_id=b.id)))`;
}
export function contactSearch(search: string) {
  const pattern = '%' + normalizeRuleText(search).replace(/[%_\\]/g, '\\$&') + '%';
  const digits = search.replace(/\D/g, '');
  const numeric = /^[\d\s()+.\-/]+$/.test(search) && digits.length >= 2;
  const numericMatch = numeric
    ? sql<boolean>`(regexp_replace(contacts.phone,'[^0-9]','','g') like ${'%' + digits + '%'}
      or exists(select 1 from jsonb_array_elements(contacts.phones) p where regexp_replace(p->>'number','[^0-9]','','g') like ${'%' + digits + '%'})
      or exists(select 1 from contact_email_links l left join contact_companies cc on cc.id=l.company_id and cc.tenant_id=l.tenant_id left join contact_addresses a on a.id=l.address_id and a.tenant_id=l.tenant_id
        where l.tenant_id=contacts.tenant_id and l.contact_id=contacts.id and (cc.cnpj like ${'%' + digits + '%'} or regexp_replace(a.cep,'[^0-9]','','g') like ${'%' + digits + '%'})))`
    : sql<boolean>`false`;
  return sql<boolean>`(lower(unaccent(concat_ws(' ',contacts.name,contacts.job_title,contacts.phone,contacts.phones::text,contacts.notes))) like ${pattern}
    or ${numericMatch}
    or exists(select 1 from contact_emails e where e.tenant_id=contacts.tenant_id and e.contact_id=contacts.id and e.email ilike ${pattern})
    or exists(select 1 from contact_email_links l left join contact_companies cc on cc.id=l.company_id and cc.tenant_id=l.tenant_id left join contact_addresses a on a.id=l.address_id and a.tenant_id=l.tenant_id
      where l.tenant_id=contacts.tenant_id and l.contact_id=contacts.id and lower(unaccent(concat_ws(' ',cc.name,cc.trade_name,cc.cnpj,a.street,a.number,a.complement,a.district,a.city,a.state,a.country,a.cep))) like ${pattern}))`;
}
export async function registerContacts(app: FastifyInstance, r: Resources) {
  app.get('/api/contacts/companies', async (req) => {
    const c = requireTenant(req.ctx),
      { search } = z.object({ search: z.string().trim().max(200).default('') }).parse(req.query);
    const pattern = '%' + normalizeRuleText(search).replace(/[%_\\]/g, '\\$&') + '%';
    const rows = await sql<{
      id: string;
      name: string;
      trade_name: string;
      cnpj: string | null;
    }>`select cc.id,cc.name,cc.trade_name,cc.cnpj from contact_companies cc
      where cc.tenant_id=${c.tenantId} and lower(unaccent(concat_ws(' ',cc.name,cc.trade_name,cc.cnpj))) like ${pattern}
      and exists(select 1 from contacts join contact_email_links l on l.contact_id=contacts.id and l.tenant_id=contacts.tenant_id where l.company_id=cc.id and contacts.tenant_id=${c.tenantId} and ${contactVisible(c)})
      order by cc.name,cc.id limit 50`.execute(r.db);
    return { items: rows.rows.map((company) => ({ ...company, cnpj: company.cnpj ?? '' })) };
  });
  async function read(db: Database, c: ReturnType<typeof requireTenant>, id: string) {
    const contact = await db
      .selectFrom('contacts')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('id', '=', id)
      .where(contactVisible(c))
      .executeTakeFirst();
    if (!contact) throw notFound();
    const emails = await db
      .selectFrom('contact_emails')
      .select(['id', 'email', 'label', 'is_primary'])
      .where('tenant_id', '=', c.tenantId)
      .where('contact_id', '=', id)
      .orderBy('is_primary', 'desc')
      .orderBy('email')
      .execute();
    const links = emails.length
      ? await db
          .selectFrom('contact_email_links')
          .selectAll()
          .where('tenant_id', '=', c.tenantId)
          .where(
            'email_id',
            'in',
            emails.map((e) => e.id),
          )
          .orderBy('is_primary_company', 'desc')
          .orderBy('id')
          .execute()
      : [];
    const companyIds = [...new Set(links.flatMap((l) => (l.company_id ? [l.company_id] : [])))],
      addressIds = [...new Set(links.flatMap((l) => (l.address_id ? [l.address_id] : [])))];
    const companies = companyIds.length
      ? (
          await db
            .selectFrom('contact_companies')
            .select(['id', 'name', 'trade_name', 'cnpj'])
            .where('tenant_id', '=', c.tenantId)
            .where('id', 'in', companyIds)
            .execute()
        ).map((company) => ({ ...company, cnpj: company.cnpj ?? '' }))
      : [];
    const addresses = addressIds.length
      ? await db
          .selectFrom('contact_addresses')
          .selectAll()
          .where('tenant_id', '=', c.tenantId)
          .where('id', 'in', addressIds)
          .execute()
      : [];
    const boxes = await db
      .selectFrom('contact_mailboxes')
      .select('mailbox_id')
      .where('tenant_id', '=', c.tenantId)
      .where('contact_id', '=', id)
      .execute();
    return {
      ...contact,
      phones: z.array(contactPhoneSchema).parse(contact.phones),
      mailbox_ids: boxes.map((b) => b.mailbox_id),
      emails: emails.map((e) => ({
        email: e.email,
        label: e.label,
        is_primary: e.is_primary,
        links: links
          .filter((l) => l.email_id === e.id)
          .map((l) => ({
            label: l.label,
            is_primary_company: l.is_primary_company,
            company: companies.find((v) => v.id === l.company_id) ?? null,
            address: addresses.find((v) => v.id === l.address_id) ?? null,
          })),
      })),
    };
  }
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
          mailbox_id: z.uuid().optional(),
          email: emailSchema.optional(),
          sort: z.enum(['name', 'created_at']).default('name'),
          direction: z.enum(['asc', 'desc']).default('asc'),
        })
        .parse(req.query);
    let query = r.db
      .selectFrom('contacts')
      .where('contacts.tenant_id', '=', c.tenantId)
      .where(contactVisible(c));
    if (q.mailbox_id) {
      await requireMailboxPerm(c, r.db, q.mailbox_id, 'read');
      query = query.where(
        sql<boolean>`(contacts.visibility='all' or exists(select 1 from contact_mailboxes cm where cm.contact_id=contacts.id and cm.tenant_id=${c.tenantId} and cm.mailbox_id=${q.mailbox_id}))`,
      );
    }
    if (q.email)
      query = query.where(
        sql<boolean>`exists(select 1 from contact_emails e where e.tenant_id=contacts.tenant_id and e.contact_id=contacts.id and e.email=${q.email})`,
      );
    if (q.search) query = query.where(contactSearch(q.search));
    const count = await query
      .select((eb) => eb.fn.countAll<number>().as('n'))
      .executeTakeFirstOrThrow();
    const items = await query
      .select([
        'contacts.id',
        'contacts.name',
        'contacts.phone',
        'contacts.job_title',
        sql<
          string | null
        >`(select cc.name from contact_email_links l join contact_companies cc on cc.id=l.company_id and cc.tenant_id=l.tenant_id where l.tenant_id=contacts.tenant_id and l.contact_id=contacts.id and l.is_primary_company limit 1)`.as(
          'primary_company',
        ),
        sql<
          string | null
        >`(select e.email from contact_emails e where e.contact_id=contacts.id and e.tenant_id=contacts.tenant_id and e.is_primary limit 1)`.as(
          'primary_email',
        ),
        'contacts.visibility',
        'contacts.created_at',
        sql<
          string[]
        >`array(select e.email from contact_emails e where e.tenant_id=contacts.tenant_id and e.contact_id=contacts.id order by e.is_primary desc,e.email)`.as(
          'emails',
        ),
      ])
      .orderBy(('contacts.' + q.sort) as 'contacts.name' | 'contacts.created_at', q.direction)
      .orderBy('contacts.id')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { items, total: Number(count.n), page: q.page, pageSize: q.pageSize };
  });
  app.get('/api/contacts/:id', async (req) => read(r.db, requireTenant(req.ctx), idOf(req.params)));
  async function save(ctx: RequestContext | null, id: string | null, body: unknown) {
    const c = requireTenant(ctx),
      b = contactSchema.parse(body);
    const phones = b.phones ?? (b.phone ? [{ number: b.phone, label: '', is_primary: true }] : []);
    if (phones.length && !phones.some((p) => p.is_primary)) phones[0]!.is_primary = true;
    if (!b.emails.some((e) => e.is_primary)) b.emails[0]!.is_primary = true;
    const links = b.emails.flatMap((e) => e.links);
    if (!links.some((l) => l.is_primary_company)) {
      const firstCompany = links.find((l) => l.company);
      if (firstCompany) firstCompany.is_primary_company = true;
    }
    const mayControl =
      isTenantAdmin(c.tenantRole) ||
      canDelegate(c.tenantRole, c.capabilities, 'contacts_visibility');
    if (!mayControl && (b.visibility !== undefined || b.mailbox_ids !== undefined))
      throw forbidden();
    if (b.visibility === 'selected' && !b.mailbox_ids?.length)
      throw new ApiError(
        400,
        'validation_error',
        'Selecione ao menos uma caixa para exibir o contato.',
      );
    if (b.mailbox_ids)
      for (const box of b.mailbox_ids) await requireMailboxPerm(c, r.db, box, 'read');
    const contactId = await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      const companyIds = [...new Set(links.flatMap((l) => (l.company?.id ? [l.company.id] : [])))];
      const knownCompanies = companyIds.length
        ? (
            await sql<{
              id: string;
            }>`select cc.id from contact_companies cc where cc.tenant_id=${c.tenantId} and cc.id in (${sql.join(companyIds.map((company) => sql`${company}::uuid`))})
        and exists(select 1 from contacts join contact_email_links l on l.contact_id=contacts.id and l.tenant_id=contacts.tenant_id where l.company_id=cc.id and contacts.tenant_id=${c.tenantId} and ${contactVisible(c)})`.execute(
              tx,
            )
          ).rows
        : [];
      if (knownCompanies.length !== companyIds.length) throw notFound();
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
      if (duplicate)
        throw conflict(
          'Um dos e-mails já pertence a outro contato desta empresa. Revise os endereços ou solicite o vínculo a um administrador.',
        );
      if (id) {
        await read(tx, c, id);
        await tx
          .selectFrom('contacts')
          .select('id')
          .where('id', '=', id)
          .where('tenant_id', '=', c.tenantId)
          .forUpdate()
          .executeTakeFirstOrThrow();
      }
      const values = {
        name: b.name,
        phone: phones.find((p) => p.is_primary)?.number ?? '',
        phones: asJson(phones),
        job_title: b.job_title ?? '',
        notes: b.notes,
        updated_at: new Date(),
        ...(b.visibility ? { visibility: b.visibility } : {}),
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
      if (id)
        await tx
          .deleteFrom('contact_emails')
          .where('tenant_id', '=', c.tenantId)
          .where('contact_id', '=', id)
          .execute();
      for (const entry of b.emails) {
        const email = await tx
          .insertInto('contact_emails')
          .values({
            tenant_id: c.tenantId,
            contact_id: row.id,
            email: entry.email,
            label: entry.label,
            is_primary: entry.is_primary ?? false,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        for (const link of entry.links) {
          let companyId: string | null = null,
            addressId: string | null = null;
          if (link.company) {
            const company = link.company;
            const byId = company.id
              ? knownCompanies.find((companyRow) => companyRow.id === company.id)
              : null;
            const existing =
              byId ??
              (company.cnpj
                ? await tx
                    .selectFrom('contact_companies')
                    .select('id')
                    .where('tenant_id', '=', c.tenantId)
                    .where('cnpj', '=', company.cnpj)
                    .executeTakeFirst()
                : null);
            if (existing) {
              companyId = existing.id;
              await tx
                .updateTable('contact_companies')
                .set({
                  name: company.name,
                  trade_name: company.trade_name,
                  cnpj: company.cnpj || null,
                })
                .where('tenant_id', '=', c.tenantId)
                .where('id', '=', existing.id)
                .execute();
            } else
              companyId = (
                await tx
                  .insertInto('contact_companies')
                  .values({
                    name: company.name,
                    trade_name: company.trade_name,
                    cnpj: company.cnpj || null,
                    tenant_id: c.tenantId,
                  })
                  .returning('id')
                  .executeTakeFirstOrThrow()
              ).id;
          }
          if (link.address)
            addressId = (
              await tx
                .insertInto('contact_addresses')
                .values({ ...link.address, tenant_id: c.tenantId })
                .returning('id')
                .executeTakeFirstOrThrow()
            ).id;
          await tx
            .insertInto('contact_email_links')
            .values({
              tenant_id: c.tenantId,
              contact_id: row.id,
              email_id: email.id,
              company_id: companyId,
              address_id: addressId,
              label: link.label,
              is_primary_company: link.is_primary_company ?? false,
            })
            .execute();
        }
      }
      if (b.mailbox_ids !== undefined || b.visibility === 'all') {
        await tx
          .deleteFrom('contact_mailboxes')
          .where('tenant_id', '=', c.tenantId)
          .where('contact_id', '=', row.id)
          .execute();
        if (b.visibility !== 'all' && b.mailbox_ids?.length)
          await tx
            .insertInto('contact_mailboxes')
            .values(
              b.mailbox_ids.map((mailbox_id) => ({
                tenant_id: c.tenantId,
                contact_id: row.id,
                mailbox_id,
              })),
            )
            .execute();
      }
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
    // A restriction change may intentionally remove the editor's own visibility.
    return { id: contactId };
  }
  app.post('/api/contacts', async (req, reply) =>
    reply.code(201).send(await save(req.ctx, null, req.body)),
  );
  app.put('/api/contacts/:id', async (req) => save(req.ctx, idOf(req.params), req.body));
  app.delete('/api/contacts/:id', async (req) => {
    const c = requireCapability(req.ctx, 'contacts_visibility'),
      id = idOf(req.params);
    await read(r.db, c, id);
    await r.db.transaction().execute(async (tx) => {
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
    return { ok: true };
  });
  for (const kind of ['cep', 'cnpj'] as const)
    app.get(
      '/api/contacts/lookup/' + kind + '/:value',
      { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (req) => {
        requireTenant(req.ctx);
        const raw = z.object({ value: z.string().max(30) }).parse(req.params).value;
        const value = raw.replace(/[.\-/\s]/g, '').toUpperCase();
        if (!(kind === 'cep' ? /^\d{8}$/ : /^[A-Z\d]{12}\d{2}$/).test(value))
          throw new ApiError(
            400,
            'validation_error',
            kind === 'cep' ? 'CEP deve ter 8 números.' : 'CNPJ deve ter 14 caracteres.',
          );
        const key = `lookup:${kind}:${value}`,
          cached = await r.redis.get(key);
        if (cached) return JSON.parse(cached);
        let response: Response;
        let source = kind === 'cep' ? 'ViaCEP' : 'BrasilAPI';
        try {
          const primary = await fetch(
            kind === 'cep'
              ? `https://viacep.com.br/ws/${value}/json/`
              : `https://brasilapi.com.br/api/cnpj/v1/${value}`,
            { signal: AbortSignal.timeout(7000) },
          ).catch(() => null);
          if (
            kind === 'cnpj' &&
            (!primary || [403, 429].includes(primary.status) || primary.status >= 500)
          ) {
            response = await fetch(`https://minhareceita.org/${value}`, {
              signal: AbortSignal.timeout(7000),
            });
            source = 'Minha Receita';
          } else if (primary) response = primary;
          else throw new Error('lookup_unavailable');
        } catch {
          throw new ApiError(
            503,
            'lookup_unavailable',
            'Consulta indisponível. Preencha os dados manualmente.',
          );
        }
        if (!response.ok)
          throw new ApiError(
            response.status === 404 ? 404 : 503,
            'lookup_unavailable',
            'Não foi possível consultar. Preencha os dados manualmente.',
          );
        const data = (await response.json()) as Record<string, unknown>;
        if (data.erro) throw new ApiError(404, 'not_found', 'CEP não encontrado.');
        const str = (key: string) =>
          typeof data[key] === 'string' ? String(data[key]).slice(0, 200) : '';
        const result =
          kind === 'cep'
            ? {
                address: {
                  cep: value,
                  street: str('logradouro'),
                  number: '',
                  complement: str('complemento'),
                  district: str('bairro'),
                  city: str('localidade'),
                  state: str('uf'),
                  country: 'Brasil',
                },
                source: 'ViaCEP',
                queried_at: new Date().toISOString(),
              }
            : {
                company: {
                  name: str('razao_social'),
                  trade_name: str('nome_fantasia'),
                  cnpj: value,
                },
                address: {
                  cep: str('cep'),
                  street: [str('descricao_tipo_de_logradouro'), str('logradouro')]
                    .filter(Boolean)
                    .join(' '),
                  number: str('numero'),
                  complement: str('complemento'),
                  district: str('bairro'),
                  city: str('municipio'),
                  state: str('uf'),
                  country: 'Brasil',
                },
                source,
                queried_at: new Date().toISOString(),
              };
        await r.redis.set(key, JSON.stringify(result), 'EX', 3600);
        return result;
      },
    );
}
