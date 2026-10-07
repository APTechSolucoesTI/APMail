import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { asJson, audit, lockStorageTenant } from '@apmail/db';
import { companySchema, normalizeRuleText } from '@apmail/shared';
import { requireTenant, requireCapability, notFound, conflict } from '../authz/context.js';
import type { Resources } from './resources.js';
export function companyVisible(c: ReturnType<typeof requireTenant>) {
  return sql<boolean>`cc.tenant_id=${c.tenantId}`;
}
export function companySearch(search: string) {
  const normalized = normalizeRuleText(search),
    pattern = '%' + normalized.replace(/[%_\\]/g, '\\$&') + '%';
  const document = search.replace(/[.\-/\s]/g, '').toUpperCase();
  return sql<boolean>`(lower(unaccent(regexp_replace(concat_ws(' ',cc.name,cc.trade_name,cc.cnpj),'\\s+',' ','g'))) like ${pattern} or cc.cnpj like ${'%' + document.replace(/[%_\\]/g, '\\$&') + '%'})`;
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
    return { ...row, cnpj: row.cnpj ?? '' };
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
        r.io.to('tenant:' + c.tenantId).emit('directory:changed', {});
        return reply.code(id ? 200 : 201).send(result);
      },
    });
  app.delete('/api/companies/:id', async (req) => {
    const c = requireCapability(req.ctx, 'contacts_manage'),
      id = idOf(req.params);
    await read(c, id);
    await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      if (
        await tx
          .selectFrom('contact_company_links')
          .select('contact_id')
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
    r.io.to('tenant:' + c.tenantId).emit('directory:changed', {});
    return { ok: true };
  });
}
