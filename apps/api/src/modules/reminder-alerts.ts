import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { requireTenant } from '../authz/context.js';
import type { Resources } from './resources.js';
export async function registerReminderAlerts(app: FastifyInstance, r: Resources) {
  const input = z.object({ client_id: z.uuid() });
  app.post('/api/reminders/alerts/claim', async (req) => {
    const c = requireTenant(req.ctx),
      { client_id } = input.parse(req.body);
    return r.db.transaction().execute(async (tx) => {
      await sql`select pg_advisory_xact_lock(hashtext(${c.tenantId + c.userId + 'reminder-alert'}))`.execute(
        tx,
      );
      const other = await tx
        .selectFrom('reminders')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .where('status', '=', 'notified')
        .where('alert_owner', '!=', client_id)
        .where('alert_lease_until', '>', new Date())
        .executeTakeFirst();
      if (other) return [];
      const rows = await tx
        .selectFrom('reminders')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .where('status', '=', 'notified')
        .where((eb) =>
          eb.or([
            eb('alert_owner', '=', client_id),
            eb('alert_lease_until', 'is', null),
            eb('alert_lease_until', '<', new Date()),
          ]),
        )
        .orderBy('due_at')
        .limit(50)
        .forUpdate()
        .execute();
      if (!rows.length) return [];
      await tx
        .updateTable('reminders')
        .set({ alert_owner: client_id, alert_lease_until: new Date(Date.now() + 45000) })
        .where(
          'id',
          'in',
          rows.map((v) => v.id),
        )
        .execute();
      return tx
        .selectFrom('reminders as m')
        .leftJoin('calendar_events as e', 'e.id', 'm.event_id')
        .leftJoin('threads as t', 't.id', 'm.thread_id')
        .select([
          'm.id',
          'm.title',
          'm.notes',
          'm.due_at',
          'm.event_id',
          'm.thread_id',
          't.mailbox_id',
          'e.description',
          'e.starts_at',
          'e.ends_at',
          'm.event_start_at',
          'm.event_end_at',
          'e.meeting_url',
          'e.attendees',
          'e.timezone',
          'm.occurrence_at',
        ])
        .where(
          'm.id',
          'in',
          rows.map((v) => v.id),
        )
        .orderBy('m.due_at')
        .execute();
    });
  });
  app.post('/api/reminders/alerts/release', async (req) => {
    const c = requireTenant(req.ctx),
      { client_id } = input.parse(req.body);
    await r.db
      .updateTable('reminders')
      .set({ alert_owner: null, alert_lease_until: null })
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('alert_owner', '=', client_id)
      .execute();
    return { ok: true };
  });
}
