import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { accessScheduleSchema, defaultAccessSchedule, isTenantAdmin } from '@apmail/shared';
import { asJson, audit } from '@apmail/db';
import { forbidden, requireTenantAdmin } from '../authz/context.js';
import { requireMember } from './tenants.js';
import type { Resources } from './resources.js';

export async function registerAccessSchedules(app: FastifyInstance, r: Resources) {
  for (const method of ['GET', 'PUT'] as const)
    app.route({
      method,
      url: '/api/members/:userId/access-schedule',
      handler: async (req) => {
        const c = requireTenantAdmin(req.ctx, 'users.manage');
        const { userId } = z.object({ userId: z.uuid() }).parse(req.params);
        return r.db
          .transaction()
          .execute(async (tx) => {
            // Same lock as role changes; a delegated manager cannot race an elevation.
            await tx
              .selectFrom('tenants')
              .select('id')
              .where('id', '=', c.tenantId)
              .forUpdate()
              .executeTakeFirstOrThrow();
            const target = await requireMember(c, { ...r, db: tx }, userId);
            if (
              ((c.accessRestricted ?? !!c.accessProfileId) &&
                (userId === c.userId || isTenantAdmin(target.role))) ||
              (target.role === 'owner' && c.tenantRole !== 'owner')
            )
              throw forbidden();
            const tenant = await tx
              .selectFrom('tenants')
              .select('timezone')
              .where('id', '=', c.tenantId)
              .executeTakeFirstOrThrow();
            const member = await tx
              .selectFrom('tenant_members')
              .select('access_schedule')
              .where('tenant_id', '=', c.tenantId)
              .where('user_id', '=', userId)
              .executeTakeFirstOrThrow();
            if (method === 'GET')
              return {
                schedule:
                  member.access_schedule == null
                    ? defaultAccessSchedule()
                    : accessScheduleSchema.parse(member.access_schedule),
                timezone: tenant.timezone,
              };
            const schedule = accessScheduleSchema.parse(req.body);
            await tx
              .updateTable('tenant_members')
              .set({ access_schedule: asJson(schedule) })
              .where('tenant_id', '=', c.tenantId)
              .where('user_id', '=', userId)
              .execute();
            await audit(tx, {
              tenantId: c.tenantId,
              actorId: c.userId,
              action: 'member.access_schedule_updated',
              entityType: 'user',
              entityId: userId,
              metadata: { before: member.access_schedule, after: schedule },
              ip: c.ip,
            });
            return { schedule, timezone: tenant.timezone };
          })
          .then((result) => {
            if (method === 'PUT') {
              r.io.to('user:' + userId).emit('access:changed', {});
              r.io.in('user:' + userId).disconnectSockets(true);
            }
            return result;
          });
      },
    });
}
