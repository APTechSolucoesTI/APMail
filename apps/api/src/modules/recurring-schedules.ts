import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { isTenantAdmin } from '@apmail/shared';
import { lockStorageTenant, audit } from '@apmail/db';
import { requireTenant, notFound } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from './resources.js';
export async function registerRecurringSchedules(app: FastifyInstance, r: Resources) {
  app.get('/api/outbox/recurrences', async (req) => {
    const c = requireTenant(req.ctx);
    return (
      await sql`select s.id,s.mailbox_id,s.created_by,s.unit,s.interval,s.timezone,s.starts_at,s.end_at,s.max_occurrences,
      o.subject,o.to_addresses,o.status as latest_status,o.last_error,
      case when o.status in ('queued','scheduled') then o.send_after else null end as next_at,
      (select count(*)::int from outbox sent where sent.recurrence_id=s.id and sent.status='sent') as sent_count
      from mail_schedule_series s join lateral(select subject,to_addresses,status,last_error,send_after from outbox
        where recurrence_id=s.id order by recurrence_sequence desc limit 1) o on true
      where s.tenant_id=${c.tenantId} and s.state='active' and (s.created_by=${c.userId} or ${isTenantAdmin(c.tenantRole)}
        or exists(select 1 from mailbox_members mm where mm.mailbox_id=s.mailbox_id and mm.tenant_id=s.tenant_id and mm.user_id=${c.userId} and mm.role='mailbox_admin'))
      order by s.created_at desc,s.id limit 20`.execute(r.db)
    ).rows;
  });
  app.post('/api/outbox/recurrences/:id/cancel', async (req) => {
    const c = requireTenant(req.ctx),
      { id } = z.object({ id: z.uuid() }).parse(req.params);
    const series = await r.db
      .selectFrom('mail_schedule_series')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .executeTakeFirst();
    if (!series) throw notFound();
    if (series.created_by !== c.userId)
      await requireMailboxPerm(c, r.db, series.mailbox_id, 'cancel_any');
    const pending = await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      await tx
        .updateTable('mail_schedule_series')
        .set({ state: 'cancelled', updated_at: new Date() })
        .where('id', '=', id)
        .execute();
      const jobs = await tx
        .updateTable('outbox')
        .set({ status: 'canceled', scheduled_at: null, send_after: null })
        .where('recurrence_id', '=', id)
        .where('status', 'in', ['queued', 'scheduled', 'failed'])
        .returning(['id', 'job_id'])
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'outbox.recurrence_cancelled',
        entityType: 'mail_schedule_series',
        entityId: id,
        ip: c.ip,
      });
      return jobs;
    });
    for (const job of pending)
      if (job.job_id) await r.queues['outbox-send'].remove(job.job_id).catch(() => undefined);
    r.io
      .to('mailbox:' + series.mailbox_id)
      .emit('outbox:changed', { mailbox_id: series.mailbox_id });
    return { ok: true };
  });
}
