import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { domainNameSchema, domainUpdateSchema, type DomainDnsSnapshot } from '@apmail/shared';
import { audit, asJson, ensureMailboxDomain } from '@apmail/db';
import {
  requireTenantAdmin,
  notFound,
  conflict,
  type RequestContext,
} from '../../authz/context.js';
import { requireMailboxPerm } from '../../authz/guards.js';
import type { Resources } from '../resources.js';
import { inspectDomainDns } from './dns.js';
export async function registerDomains(app: FastifyInstance, r: Resources) {
  const get = async (ctx: RequestContext | null, id: string) => {
    const c = requireTenantAdmin(ctx, 'domains.view');
    const row = await r.db
      .selectFrom('tenant_domains')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound();
    return { c, row };
  };
  const idOf = (p: unknown) => z.object({ id: z.uuid() }).parse(p).id;
  app.get('/api/mailbox-domains', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'mailboxes.manage');
    return r.db
      .selectFrom('tenant_domains')
      .select(['id', 'domain', 'display_name'])
      .where('tenant_id', '=', c.tenantId)
      .orderBy('domain')
      .execute();
  });
  app.post('/api/mailbox-domains', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx, 'mailboxes.manage');
    const { domain } = z.object({ domain: domainNameSchema }).parse(req.body);
    const row = await ensureMailboxDomain(r.db, c.tenantId, domain, c.userId);
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'domain.added',
      entityType: 'domain',
      entityId: row.id,
      metadata: { domain },
      ip: c.ip,
    });
    return reply.code(201).send(row);
  });
  app.get('/api/domains', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'domains.view');
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce
          .number()
          .pipe(
            z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100)]),
          )
          .default(10),
        search: z.string().max(253).default(''),
        sort: z.enum(['domain', 'updated_at', 'checked_at']).default('domain'),
        direction: z.enum(['asc', 'desc']).default('asc'),
      })
      .parse(req.query);
    let base = r.db
      .selectFrom('tenant_domains as d')
      .leftJoin('tenant_domain_checks as ch', 'ch.domain_id', 'd.id')
      .where('d.tenant_id', '=', c.tenantId);
    if (q.search)
      base = base.where(
        'd.domain',
        'ilike',
        '%' + q.search.replaceAll('%', '\\%').replaceAll('_', '\\_') + '%',
      );
    const count = await base.select(sql<string>`count(*)`.as('total')).executeTakeFirstOrThrow();
    const items = await base
      .selectAll('d')
      .select('ch.snapshot as check')
      .orderBy(
        q.sort === 'checked_at'
          ? 'ch.checked_at'
          : q.sort === 'updated_at'
            ? 'd.updated_at'
            : 'd.domain',
        q.direction,
      )
      .orderBy('d.id')
      .offset((q.page - 1) * q.pageSize)
      .limit(q.pageSize)
      .execute();
    return { items, total: Number(count.total), page: q.page, pageSize: q.pageSize };
  });
  app.post('/api/domains', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx, 'domains.manage');
    const { domain } = z.object({ domain: domainNameSchema }).parse(req.body);
    const row = await ensureMailboxDomain(r.db, c.tenantId, domain, c.userId);
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'domain.added',
      entityType: 'domain',
      entityId: row.id,
      metadata: { domain },
      ip: c.ip,
    });
    return reply.code(201).send(row);
  });
  app.get('/api/domains/:id', async (req) => {
    const { c, row } = await get(req.ctx, idOf(req.params));
    const check = await r.db
      .selectFrom('tenant_domain_checks')
      .select('snapshot')
      .where('domain_id', '=', row.id)
      .where('tenant_id', '=', c.tenantId)
      .executeTakeFirst();
    const candidates = await r.db
      .selectFrom('mailboxes')
      .select(['id', 'name', 'email_address', 'status'])
      .where('tenant_id', '=', c.tenantId)
      .where('domain_id', '=', row.id)
      .where('deleted_at', 'is', null)
      .execute();
    const boxes = [];
    for (const b of candidates) {
      try {
        await requireMailboxPerm(c, r.db, b.id, 'read');
        boxes.push(b);
      } catch {
        /* Do not reveal unauthorized mailbox metadata. */
      }
    }
    return { ...row, check: check?.snapshot ?? null, mailboxes: boxes };
  });
  app.patch('/api/domains/:id', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'domains.manage');
    const { row } = await get(c, idOf(req.params));
    const body = domainUpdateSchema.parse(req.body);
    await r.db
      .updateTable('tenant_domains')
      .set(body)
      .where('id', '=', row.id)
      .where('tenant_id', '=', c.tenantId)
      .execute();
    await r.db.deleteFrom('tenant_domain_checks').where('domain_id', '=', row.id).execute();
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'domain.updated',
      entityType: 'domain',
      entityId: row.id,
      metadata: body,
      ip: c.ip,
    });
    return { ok: true };
  });
  app.delete('/api/domains/:id', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'domains.manage');
    const { row } = await get(c, idOf(req.params));
    if (
      await r.db
        .selectFrom('mailboxes')
        .select('id')
        .where('domain_id', '=', row.id)
        .executeTakeFirst()
    )
      throw conflict(
        'Este domínio está vinculado a caixas. Remova os vínculos antes de excluí-lo.',
      );
    await r.db
      .deleteFrom('tenant_domains')
      .where('id', '=', row.id)
      .where('tenant_id', '=', c.tenantId)
      .execute();
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'domain.removed',
      entityType: 'domain',
      entityId: row.id,
      metadata: { domain: row.domain },
      ip: c.ip,
    });
    return { ok: true };
  });
  app.post(
    '/api/domains/:id/check-dns',
    { config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (req) => {
      const { c, row } = await get(req.ctx, idOf(req.params));
      const previous = await r.db
        .selectFrom('tenant_domain_checks')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('domain_id', '=', row.id)
        .executeTakeFirst();
      if (previous && Date.now() - previous.checked_at.getTime() < 60000)
        return { cached: true, snapshot: previous.snapshot as unknown as DomainDnsSnapshot };
      const key = 'apmail:dns:' + c.tenantId + ':' + row.id;
      if (!(await r.redis.set(key, 'checking', 'EX', 12, 'NX')))
        throw conflict('A consulta deste domínio já está em andamento.');
      try {
        const snapshot = await inspectDomainDns(row);
        await r.db
          .insertInto('tenant_domain_checks')
          .values({ domain_id: row.id, tenant_id: c.tenantId, snapshot: asJson(snapshot) })
          .onConflict((oc) =>
            oc
              .column('domain_id')
              .doUpdateSet({ snapshot: asJson(snapshot), checked_at: new Date() }),
          )
          .execute();
        await audit(r.db, {
          tenantId: c.tenantId,
          actorId: c.userId,
          action: 'domain.dns_checked',
          entityType: 'domain',
          entityId: row.id,
          ip: c.ip,
        });
        return { cached: false, snapshot };
      } finally {
        await r.redis.del(key);
      }
    },
  );
}
