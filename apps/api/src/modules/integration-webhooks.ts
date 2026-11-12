import { randomBytes, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { audit, encryptSecret, webhookUrl } from '@apmail/db';
import { conflict, forbidden, notFound, requireTenantAdmin } from '../authz/context.js';
import type { Resources } from './resources.js';

const webhookEvent = z.enum(['email.received', 'email.sent']);
const configSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    url: z
      .string()
      .trim()
      .max(2048)
      .refine((url) => {
        try {
          webhookUrl(url);
          return true;
        } catch {
          return false;
        }
      }, 'Informe uma URL HTTPS pública na porta 443, sem credenciais ou fragmento.'),
    enabled: z.boolean().default(false),
    event: webhookEvent.optional(),
    events: z.array(webhookEvent).min(1).max(2).optional(),
    mailbox_ids: z
      .array(z.uuid())
      .min(1)
      .max(1000)
      .transform((ids) => [...new Set(ids)]),
  })
  .refine((b) => b.events || b.event, {
    message: 'Selecione ao menos um evento.',
    path: ['events'],
  })
  .transform((b) => ({ ...b, events: [...new Set(b.events ?? [b.event!])] }));
const idSchema = z.object({ id: z.uuid() });

export function registerIntegrationWebhooks(app: FastifyInstance, r: Resources) {
  async function availableBoxes(tenantId: string, userId: string) {
    return r.db
      .selectFrom('mailboxes as b')
      .innerJoin('mailbox_members as m', (j) =>
        j.onRef('m.mailbox_id', '=', 'b.id').onRef('m.tenant_id', '=', 'b.tenant_id'),
      )
      .select(['b.id', 'b.name', 'b.email_address'])
      .where('b.tenant_id', '=', tenantId)
      .where('b.deleted_at', 'is', null)
      .where('m.user_id', '=', userId)
      .where('m.role', '=', 'mailbox_admin')
      .orderBy('b.name')
      .execute();
  }
  app.get('/api/integrations/webhooks', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx, 'integrations');
    reply.header('Cache-Control', 'no-store');
    const [webhooks, mailboxes] = await Promise.all([
      r.db
        .selectFrom('integration_webhooks as w')
        .select([
          'w.id',
          'w.name',
          'w.url',
          'w.enabled',
          'w.event',
          'w.events',
          'w.created_at',
          'w.updated_at',
          sql<
            string[]
          >`array(select b.mailbox_id::text from integration_webhook_mailboxes b where b.tenant_id=w.tenant_id and b.webhook_id=w.id order by b.mailbox_id)`.as(
            'mailbox_ids',
          ),
        ])
        .where('w.tenant_id', '=', c.tenantId)
        .orderBy('w.created_at', 'desc')
        .execute(),
      availableBoxes(c.tenantId, c.userId),
    ]);
    return { webhooks, mailboxes };
  });
  app.post('/api/integrations/webhooks', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx, 'integrations'),
      b = configSchema.parse(req.body);
    const allowed = await availableBoxes(c.tenantId, c.userId);
    if (b.mailbox_ids.some((id) => !allowed.some((box) => box.id === id))) throw forbidden();
    const secret = randomBytes(32).toString('base64url');
    const row = await r.db.transaction().execute(async (tx) => {
      const saved = await tx
        .insertInto('integration_webhooks')
        .values({
          tenant_id: c.tenantId,
          name: b.name,
          url: b.url,
          enabled: b.enabled,
          event: b.events[0]!,
          events: b.events,
          created_by: c.userId,
          encrypted_secret: encryptSecret(secret, r.env.CREDENTIALS_ENCRYPTION_KEY),
        })
        .returning(['id', 'name'])
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('integration_webhook_mailboxes')
        .values(
          b.mailbox_ids.map((mailbox_id) => ({
            tenant_id: c.tenantId,
            webhook_id: saved.id,
            mailbox_id,
          })),
        )
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'integration.webhook.created',
        entityType: 'integration',
        entityId: saved.id,
        metadata: { mailboxes: b.mailbox_ids.length },
        requestId: req.id,
        ip: req.ip,
      });
      return saved;
    });
    return reply
      .code(201)
      .header('Cache-Control', 'no-store')
      .send({ ...row, secret });
  });
  app.put('/api/integrations/webhooks/:id', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'integrations'),
      { id } = idSchema.parse(req.params),
      b = configSchema.parse(req.body);
    const boxes = await availableBoxes(c.tenantId, c.userId);
    if (b.mailbox_ids.some((id) => !boxes.some((box) => box.id === id))) throw forbidden();
    return r.db.transaction().execute(async (tx) => {
      const saved = await tx
        .updateTable('integration_webhooks')
        .set({
          name: b.name,
          url: b.url,
          enabled: b.enabled,
          event: b.events[0]!,
          events: b.events,
          version: sql`version+1`,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      if (!saved) throw notFound();
      await tx
        .deleteFrom('integration_webhook_mailboxes')
        .where('tenant_id', '=', c.tenantId)
        .where('webhook_id', '=', id)
        .execute();
      await tx
        .insertInto('integration_webhook_mailboxes')
        .values(
          b.mailbox_ids.map((mailbox_id) => ({
            tenant_id: c.tenantId,
            webhook_id: id,
            mailbox_id,
          })),
        )
        .execute();
      await tx
        .updateTable('integration_webhook_deliveries')
        .set({
          state: 'cancelled',
          last_error: 'configuration_changed',
          lease_token: null,
          lease_expires_at: null,
        })
        .where('tenant_id', '=', c.tenantId)
        .where('webhook_id', '=', id)
        .where('state', 'in', ['pending', 'retry', 'delivering'])
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'integration.webhook.updated',
        entityType: 'integration',
        entityId: id,
        metadata: { enabled: b.enabled, mailboxes: b.mailbox_ids.length },
        requestId: req.id,
        ip: req.ip,
      });
      return { success: true };
    });
  });
  app.post('/api/integrations/webhooks/:id/secret', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx, 'integrations'),
      { id } = idSchema.parse(req.params),
      secret = randomBytes(32).toString('base64url');
    await r.db.transaction().execute(async (tx) => {
      const saved = await tx
        .updateTable('integration_webhooks')
        .set({
          encrypted_secret: encryptSecret(secret, r.env.CREDENTIALS_ENCRYPTION_KEY),
          version: sql`version+1`,
          updated_at: new Date(),
        })
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      if (!saved) throw notFound();
      await tx
        .updateTable('integration_webhook_deliveries')
        .set({
          state: 'cancelled',
          last_error: 'configuration_changed',
          lease_token: null,
          lease_expires_at: null,
        })
        .where('tenant_id', '=', c.tenantId)
        .where('webhook_id', '=', id)
        .where('state', 'in', ['pending', 'retry', 'delivering'])
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'integration.webhook.secret_rotated',
        entityType: 'integration',
        entityId: id,
        requestId: req.id,
        ip: req.ip,
      });
    });
    return reply.header('Cache-Control', 'no-store').send({ id, secret });
  });
  app.post(
    '/api/integrations/webhooks/:id/test',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (req, reply) => {
      const c = requireTenantAdmin(req.ctx, 'integrations'),
        { id } = idSchema.parse(req.params);
      const { event } = z.object({ event: webhookEvent.optional() }).parse(req.body ?? {});
      const delivery = await r.db.transaction().execute(async (tx) => {
        const webhook = await tx
          .selectFrom('integration_webhooks')
          .select(['id', 'version', 'event', 'events'])
          .where('tenant_id', '=', c.tenantId)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!webhook) throw notFound();
        if (event && !webhook.events.includes(event))
          throw conflict('Selecione um evento habilitado no webhook.');
        const saved = await tx
          .insertInto('integration_webhook_deliveries')
          .values({
            tenant_id: c.tenantId,
            webhook_id: id,
            webhook_version: webhook.version,
            event_key: randomUUID(),
            event_type: event ?? webhook.event,
            is_test: true,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await audit(tx, {
          tenantId: c.tenantId,
          actorId: c.userId,
          action: 'integration.webhook.test',
          entityType: 'integration',
          entityId: id,
          requestId: req.id,
          ip: req.ip,
        });
        return saved;
      });
      return reply.code(202).send({ success: true, deliveryId: delivery.id });
    },
  );
  app.get('/api/integrations/webhooks/:id/deliveries', async (req, reply) => {
    const c = requireTenantAdmin(req.ctx, 'integrations'),
      { id } = idSchema.parse(req.params),
      { page } = z
        .object({ page: z.coerce.number().int().min(1).max(100000).default(1) })
        .parse(req.query);
    reply.header('Cache-Control', 'no-store');
    const exists = await r.db
      .selectFrom('integration_webhooks')
      .select('id')
      .where('tenant_id', '=', c.tenantId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!exists) throw notFound();
    const base = r.db
      .selectFrom('integration_webhook_deliveries')
      .where('tenant_id', '=', c.tenantId)
      .where('webhook_id', '=', id);
    const [deliveries, count] = await Promise.all([
      base
        .select([
          'id',
          'event_key',
          'event_type',
          'is_test',
          'state',
          'attempts',
          'max_attempts',
          'next_attempt_at',
          'last_status',
          'last_error',
          'created_at',
          'delivered_at',
        ])
        .orderBy('created_at', 'desc')
        .orderBy('id')
        .limit(25)
        .offset((page - 1) * 25)
        .execute(),
      base.select(sql<number>`count(*)::int`.as('total')).executeTakeFirstOrThrow(),
    ]);
    const attempts = deliveries.length
      ? await r.db
          .selectFrom('integration_webhook_attempts')
          .select([
            'delivery_id',
            'number',
            'started_at',
            'finished_at',
            'http_status',
            'error_code',
          ])
          .where(
            'delivery_id',
            'in',
            deliveries.map((d) => d.id),
          )
          .orderBy('number')
          .execute()
      : [];
    return {
      items: deliveries.map((d) => ({
        ...d,
        history: attempts.filter((a) => a.delivery_id === d.id),
      })),
      total: count.total,
      page,
      pageSize: 25,
    };
  });
  app.post('/api/integrations/webhooks/:id/deliveries/:deliveryId/retry', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'integrations'),
      { id, deliveryId } = idSchema.extend({ deliveryId: z.uuid() }).parse(req.params);
    return r.db.transaction().execute(async (tx) => {
      const w = await tx
        .selectFrom('integration_webhooks')
        .select(['version', 'enabled', 'events'])
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!w) throw notFound();
      const d = await tx
        .selectFrom('integration_webhook_deliveries')
        .select(['id', 'state', 'is_test', 'event_type'])
        .where('tenant_id', '=', c.tenantId)
        .where('webhook_id', '=', id)
        .where('id', '=', deliveryId)
        .forUpdate()
        .executeTakeFirst();
      if (!d) throw notFound();
      if (!w.events.includes(d.event_type))
        throw conflict('Habilite o evento desta entrega para reenviar.');
      if (!['failed', 'cancelled'].includes(d.state) || (!d.is_test && !w.enabled))
        throw conflict('Ative o webhook e escolha uma entrega encerrada para reenviar.');
      await tx
        .updateTable('integration_webhook_deliveries')
        .set({
          state: 'pending',
          webhook_version: w.version,
          max_attempts: sql`attempts+5`,
          next_attempt_at: new Date(),
          last_error: null,
          lease_token: null,
          lease_expires_at: null,
        })
        .where('id', '=', deliveryId)
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'integration.webhook.retried',
        entityType: 'integration',
        entityId: id,
        metadata: { delivery_id: deliveryId },
        requestId: req.id,
        ip: req.ip,
      });
      return { success: true };
    });
  });
  app.delete('/api/integrations/webhooks/:id', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'integrations'),
      { id } = idSchema.parse(req.params);
    return r.db.transaction().execute(async (tx) => {
      const row = await tx
        .deleteFrom('integration_webhooks')
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .returning('id')
        .executeTakeFirst();
      if (!row) throw notFound();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'integration.webhook.deleted',
        entityType: 'integration',
        entityId: id,
        requestId: req.id,
        ip: req.ip,
      });
      return { success: true };
    });
  });
}
