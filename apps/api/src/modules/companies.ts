import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { asJson, audit, lockStorageTenant } from '@apmail/db';
import {
  companySchema,
  contactAddressSchema,
  isTenantAdmin,
  canDelegate,
  normalizeRuleText,
} from '@apmail/shared';
import {
  requireTenant,
  requireCapability,
  forbidden,
  notFound,
  ApiError,
  conflict,
} from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from './resources.js';
export function companyVisible(c: ReturnType<typeof requireTenant>) {
  return sql<boolean>`(${isTenantAdmin(c.tenantRole)} or exists(select 1 from mailboxes b where b.tenant_id=${c.tenantId} and b.deleted_at is null
    and exists(select 1 from mailbox_members mm where mm.tenant_id=b.tenant_id and mm.mailbox_id=b.id and mm.user_id=${c.userId})
    and (cc.visibility='all' or exists(select 1 from contact_company_mailboxes cm where cm.company_id=cc.id and cm.tenant_id=cc.tenant_id and cm.mailbox_id=b.id))))`;
}
export function companySearch(search: string) {
  const normalized = normalizeRuleText(search),
    pattern = '%' + normalized.replace(/[%_\\]/g, '\\$&') + '%';
  const document = search.replace(/[.\-/\s]/g, '').toUpperCase();
  return sql<boolean>`(lower(unaccent(concat_ws(' ',cc.name,cc.trade_name,cc.cnpj))) like ${pattern} or cc.cnpj like ${'%' + document.replace(/[%_\\]/g, '\\$&') + '%'})`;
}
export async function registerCompanies(app: FastifyInstance, r: Resources) {
  const idOf = (p: unknown) => z.object({ id: z.uuid() }).parse(p).id;
  app.get('/api/companies', async (req) => {
    const c = requireTenant(req.ctx),
      q = z
        .object({
          search: z.string().trim().max(200).default(''),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce
            .number()
            .int()
            .refine((n) => [10, 20, 30, 50, 100].includes(n))
            .default(10),
          sort: z.enum(['name', 'trade_name', 'cnpj', 'created_at']).default('name'),
          direction: z.enum(['asc', 'desc']).default('asc'),
        })
        .parse(req.query);
    const base = r.db
      .selectFrom('contact_companies as cc')
      .where('cc.tenant_id', '=', c.tenantId)
      .where(companyVisible(c))
      .where(companySearch(q.search));
    return {
      items: (
        await base
          .selectAll('cc')
          .orderBy(`cc.${q.sort}`, q.direction)
          .orderBy('cc.id')
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize)
          .execute()
      ).map((row) => ({ ...row, cnpj: row.cnpj ?? '' })),
      total: Number(
        (await base.select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n,
      ),
      page: q.page,
      pageSize: q.pageSize,
    };
  });
  async function read(c: ReturnType<typeof requireTenant>, id: string) {
    const row = await r.db
      .selectFrom('contact_companies as cc')
      .selectAll('cc')
      .where('cc.tenant_id', '=', c.tenantId)
      .where('cc.id', '=', id)
      .where(companyVisible(c))
      .executeTakeFirst();
    if (!row) throw notFound();
    const mailboxes = await r.db
      .selectFrom('contact_company_mailboxes')
      .select('mailbox_id')
      .where('tenant_id', '=', c.tenantId)
      .where('company_id', '=', id)
      .execute();
    return {
      ...row,
      cnpj: row.cnpj ?? '',
      addresses: z.array(contactAddressSchema).parse(row.addresses),
      mailbox_ids: mailboxes.map((b) => b.mailbox_id),
    };
  }
  app.get('/api/companies/:id', async (req) => read(requireTenant(req.ctx), idOf(req.params)));
  for (const method of ['POST', 'PUT'] as const)
    app.route({
      method,
      url: method === 'POST' ? '/api/companies' : '/api/companies/:id',
      handler: async (req, reply) => {
        const c = requireTenant(req.ctx),
          b = companySchema.parse(req.body),
          id = method === 'PUT' ? idOf(req.params) : null;
        const mayControl =
          isTenantAdmin(c.tenantRole) ||
          canDelegate(c.tenantRole, c.capabilities, 'contacts_visibility');
        if (!mayControl && (b.visibility !== undefined || b.mailbox_ids !== undefined))
          throw forbidden();
        if (b.visibility === 'selected' && !b.mailbox_ids?.length)
          throw new ApiError(
            400,
            'validation_error',
            'Selecione ao menos uma caixa para exibir a empresa.',
          );
        if (b.mailbox_ids)
          for (const box of b.mailbox_ids) await requireMailboxPerm(c, r.db, box, 'read');
        if (id) await read(c, id);
        const result = await r.db.transaction().execute(async (tx) => {
          await lockStorageTenant(tx, c.tenantId);
          if (
            id &&
            !(await tx
              .selectFrom('contact_companies as cc')
              .select('cc.id')
              .where('cc.tenant_id', '=', c.tenantId)
              .where('cc.id', '=', id)
              .where(companyVisible(c))
              .executeTakeFirst())
          )
            throw notFound();
          if (
            b.cnpj &&
            (await tx
              .selectFrom('contact_companies')
              .select('id')
              .where('tenant_id', '=', c.tenantId)
              .where('cnpj', '=', b.cnpj)
              .$if(!!id, (q) => q.where('id', '!=', id!))
              .executeTakeFirst())
          )
            throw conflict('Já existe uma empresa cadastrada com este CNPJ.');
          const values = {
            name: b.name,
            trade_name: b.trade_name,
            cnpj: b.cnpj || null,
            addresses: asJson(b.addresses),
            updated_at: new Date(),
            ...(b.visibility ? { visibility: b.visibility } : {}),
          };
          const row = id
            ? await tx
                .updateTable('contact_companies')
                .set(values)
                .where('id', '=', id)
                .where('tenant_id', '=', c.tenantId)
                .returning('id')
                .executeTakeFirstOrThrow()
            : await tx
                .insertInto('contact_companies')
                .values({ ...values, tenant_id: c.tenantId })
                .returning('id')
                .executeTakeFirstOrThrow();
          if (b.mailbox_ids !== undefined || b.visibility === 'all') {
            await tx
              .deleteFrom('contact_company_mailboxes')
              .where('tenant_id', '=', c.tenantId)
              .where('company_id', '=', row.id)
              .execute();
            if (b.visibility !== 'all' && b.mailbox_ids?.length)
              await tx
                .insertInto('contact_company_mailboxes')
                .values(
                  b.mailbox_ids.map((mailbox_id) => ({
                    tenant_id: c.tenantId,
                    company_id: row.id,
                    mailbox_id,
                  })),
                )
                .execute();
          }
          await audit(tx, {
            tenantId: c.tenantId,
            actorId: c.userId,
            action: id ? 'company.updated' : 'company.created',
            entityType: 'company',
            entityId: row.id,
            metadata: { address_count: b.addresses.length },
            ip: c.ip,
          });
          return row;
        });
        return reply.code(id ? 200 : 201).send(result);
      },
    });
  app.delete('/api/companies/:id', async (req) => {
    const c = requireCapability(req.ctx, 'contacts_visibility'),
      id = idOf(req.params);
    await read(c, id);
    await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      if (
        await tx
          .selectFrom('contact_email_links')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where('company_id', '=', id)
          .executeTakeFirst()
      )
        throw conflict(
          'Esta empresa está vinculada a contatos. Remova os vínculos antes de excluir.',
        );
      await tx
        .deleteFrom('contact_companies')
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'company.deleted',
        entityType: 'company',
        entityId: id,
        ip: c.ip,
      });
    });
    return { ok: true };
  });
}
