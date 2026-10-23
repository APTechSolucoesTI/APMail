import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { audit, safeAuditMetadata } from '@apmail/db';
import { AUDIT_ACTION_LABELS, hasAccess, isTenantAdmin } from '@apmail/shared';
import { columnFilters, columnOrder } from './list-columns.js';
import { requireCapability, ApiError, notFound, type RequestContext } from '../authz/context.js';
import { readableFolders, folderPredicate } from '../authz/folders.js';
import type { Resources } from './resources.js';

const csvList = (schema: z.ZodType<string>) =>
  z
    .string()
    .max(10000)
    .transform((s) => z.array(schema).max(100).parse(s.split(',')))
    .optional();
const querySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(10),
    from: z.iso.datetime().optional(),
    to: z.iso.datetime().optional(),
    actor_id: z.uuid().optional(),
    actor_ids: csvList(z.uuid()),
    action: z.string().max(100).optional(),
    actions: csvList(z.string().min(1).max(100)),
    mailbox_id: z.uuid().optional(),
    entity_type: z.string().max(80).optional(),
    search: z.string().trim().max(200).optional(),
  })
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    'O início do período deve vir antes do término.',
  );
const columns = {
  action: sql`a.action`,
  actor_name: sql`coalesce(a.actor_name,u.full_name)`,
  entity_type: sql`a.entity_type`,
  created_at: sql`a.created_at`,
  message_subject: sql`a.message_subject`,
};
const canReadContent = (c: RequestContext) =>
  hasAccess({ role: c.tenantRole, access_permissions: c.accessPermissions }, 'audit.content');
export async function visibleAuditQuery(r: Resources, c: ReturnType<typeof requireCapability>) {
  let query = r.db
    .selectFrom('audit_logs as a')
    .leftJoin('users as u', 'u.id', 'a.actor_id')
    .where('a.tenant_id', '=', c.tenantId);
  // Legacy supervisors keep their mailbox/folder scope. A custom profile explicitly grants company audit access.
  if (!isTenantAdmin(c.tenantRole) && !(c.accessRestricted ?? !!c.accessProfileId)) {
    const boxes = await r.db
      .selectFrom('mailbox_members as mm')
      .innerJoin('mailboxes as b', 'b.id', 'mm.mailbox_id')
      .select('b.id')
      .where('mm.tenant_id', '=', c.tenantId)
      .where('mm.user_id', '=', c.userId)
      .where('b.deleted_at', 'is', null)
      .execute();
    const scopes = await Promise.all(
      boxes.map(
        async (b) =>
          sql`(m.mailbox_id=${b.id} and ${folderPredicate(await readableFolders(c, r.db, b.id))})`,
      ),
    );
    const allowed = scopes.length ? sql`(${sql.join(scopes, sql` or `)})` : sql`false`;
    query = query.where(sql<boolean>`(
      (a.entity_type='mailbox' and a.entity_id in (select b.id from mailboxes b join mailbox_members mm on mm.mailbox_id=b.id where mm.tenant_id=${c.tenantId} and mm.user_id=${c.userId} and b.deleted_at is null)) or
      (a.entity_type='thread' and exists(select 1 from messages m where m.thread_id=a.entity_id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${allowed})) or
      (a.entity_type='message' and exists(select 1 from messages m where m.id=a.entity_id and m.tenant_id=${c.tenantId} and m.deleted_at is null and ${allowed}))
    )`);
  }
  return {
    query: query.where(
      sql<boolean>`not (a.entity_type='contact' and ((a.metadata->>'scope'='personal' and a.actor_id is distinct from ${c.userId}::uuid) or exists(select 1 from contacts c where c.id=a.entity_id and c.scope='personal' and c.owner_user_id<>${c.userId})))`,
    ),
  };
}
export async function registerAuditRoutes(app: FastifyInstance, r: Resources) {
  app.get('/api/audit-logs/options', async (req) => {
    const c = requireCapability(req.ctx, 'audit'),
      { query: base } = await visibleAuditQuery(r, c);
    const [actors, actions, mailboxes] = await Promise.all([
      base
        .select([
          'a.actor_id',
          sql<string>`coalesce(a.actor_name,u.full_name,'Usuário removido')`.as('name'),
          sql<string>`coalesce(a.actor_email,u.email,'')`.as('email'),
        ])
        .distinct()
        .orderBy('name')
        .execute(),
      base.select('a.action').distinct().orderBy('a.action').execute(),
      base
        .select([
          'a.mailbox_id',
          sql<string>`coalesce(a.metadata->'mailbox'->>'name','Caixa removida')`.as('name'),
        ])
        .where('a.mailbox_id', 'is not', null)
        .distinct()
        .execute(),
    ]);
    return {
      actors,
      actions: actions.map((a) => a.action),
      mailboxes,
      can_read_content: canReadContent(c),
    };
  });
  app.get('/api/audit-logs/:id', async (req, reply) => {
    const c = requireCapability(req.ctx, 'audit'),
      { id } = z
        .object({
          id: z
            .string()
            .regex(/^[1-9]\d{0,18}$/)
            .refine((v) => BigInt(v) <= 9223372036854775807n),
        })
        .parse(req.params);
    reply.header('Cache-Control', 'no-store');
    const { query: base } = await visibleAuditQuery(r, c);
    const item = await base
      .selectAll('a')
      .select([
        sql<string>`coalesce(a.actor_name,u.full_name)`.as('actor_name'),
        sql<string>`coalesce(a.actor_email,u.email)`.as('actor_email'),
      ])
      .where('a.id', '=', id)
      .executeTakeFirst();
    if (!item) throw notFound();
    if (item.message_content && canReadContent(c))
      await audit(r.db, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'audit.content_viewed',
        entityType: 'audit',
        metadata: { audit_id: id, action: item.action, subject: item.message_subject },
        ip: c.ip,
        requestId: req.id,
      });
    return {
      ...item,
      metadata: safeAuditMetadata(item.metadata),
      message_content: canReadContent(c) ? item.message_content : null,
      has_content: item.message_content !== null,
      can_read_content: canReadContent(c),
    };
  });
  for (const exportCsv of [false, true])
    app.get('/api/audit-logs' + (exportCsv ? '/export.csv' : ''), async (req, reply) => {
      const c = requireCapability(req.ctx, 'audit'),
        q = querySchema.parse(req.query);
      reply.header('Cache-Control', 'no-store');
      let { query } = await visibleAuditQuery(r, c);
      if (q.from) query = query.where('a.created_at', '>=', new Date(q.from));
      if (q.to) query = query.where('a.created_at', '<=', new Date(q.to));
      if (q.actor_id) query = query.where('a.actor_id', '=', q.actor_id);
      if (q.actor_ids?.length) query = query.where('a.actor_id', 'in', q.actor_ids);
      if (q.actions?.length) query = query.where('a.action', 'in', q.actions);
      if (q.action)
        query = query.where('a.action', 'like', q.action.replace(/[%_\\]/g, '\\$&') + '%');
      if (q.mailbox_id) query = query.where('a.mailbox_id', '=', q.mailbox_id);
      if (q.entity_type) query = query.where('a.entity_type', '=', q.entity_type);
      if (q.search) {
        const text = '%' + q.search.replace(/[%_\\]/g, '\\$&') + '%';
        const normalize = (v: string) =>
          v
            .toLocaleLowerCase('pt-BR')
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '');
        const actions = Object.entries(AUDIT_ACTION_LABELS)
          .filter(([, label]) => normalize(label).includes(normalize(q.search!)))
          .map(([key]) => key);
        query = query.where((eb) =>
          eb.or([
            eb('u.full_name', 'ilike', text),
            eb('a.actor_name', 'ilike', text),
            eb('a.actor_email', 'ilike', text),
            eb('a.action', 'ilike', text),
            eb('a.message_subject', 'ilike', text),
            sql<boolean>`a.metadata::text ilike ${text}`,
            ...(actions.length ? [eb('a.action', 'in', actions)] : []),
          ]),
        );
      }
      query = query.where(columnFilters(req.query, columns));
      const count = await query
        .select((eb) => eb.fn.countAll<number>().as('n'))
        .executeTakeFirstOrThrow();
      if (exportCsv && Number(count.n) > 10000)
        throw new ApiError(
          400,
          'export_limit',
          'Restrinja o período ou os filtros para exportar até 10.000 registros.',
        );
      const items = await query
        .select([
          'a.id',
          'a.action',
          'a.entity_type',
          'a.entity_id',
          'a.metadata',
          'a.created_at',
          'a.actor_id',
          'a.ip',
          'a.request_id',
          'a.mailbox_id',
          'a.message_subject',
          sql<boolean>`a.message_content is not null`.as('has_content'),
          sql<string>`coalesce(a.actor_name,u.full_name)`.as('actor_name'),
          sql<string>`coalesce(a.actor_email,u.email)`.as('actor_email'),
        ])
        .orderBy(columnOrder(req.query, columns, sql`a.created_at desc`))
        .orderBy('a.id', 'desc')
        .offset(exportCsv ? 0 : (q.page - 1) * q.pageSize)
        .limit(exportCsv ? 10000 : q.pageSize)
        .execute();
      if (exportCsv) {
        const cell = (v: unknown) =>
          '"' +
          String(v ?? '')
            .replace(/^[\s]*[=+@-]/, "'$&")
            .replace(/"/g, '""') +
          '"';
        const lines = [
          [
            'Data (UTC)',
            'Usuário',
            'E-mail',
            'Ação',
            'Assunto',
            'Tipo de registro',
            'Identificador',
            'IP',
          ],
          ...items.map((a) => [
            a.created_at.toISOString(),
            a.actor_name ?? 'Sistema',
            a.actor_email,
            AUDIT_ACTION_LABELS[a.action] ?? a.action,
            a.message_subject,
            a.entity_type,
            a.entity_id,
            a.ip,
          ]),
        ];
        await audit(r.db, {
          tenantId: c.tenantId,
          actorId: c.userId,
          action: 'audit.exported',
          entityType: 'audit',
          metadata: { records: items.length, from: q.from ?? null, to: q.to ?? null },
          ip: c.ip,
          requestId: req.id,
        });
        return reply
          .header('Content-Type', 'text/csv; charset=utf-8')
          .header('Content-Disposition', 'attachment; filename="apmail-auditoria.csv"')
          .send('\ufeff' + lines.map((line) => line.map(cell).join(';')).join('\r\n'));
      }
      return {
        items: items.map((item) => ({ ...item, metadata: safeAuditMetadata(item.metadata) })),
        total: Number(count.n),
        page: q.page,
        pageSize: q.pageSize,
      };
    });
}
