import type { FastifyInstance } from 'fastify';
import { isTenantAdmin } from '@apmail/shared';
import { z } from 'zod';
import {
  ApiError,
  forbidden,
  notFound,
  requireTenant,
  type RequestContext,
} from '../authz/context.js';
import { requireThread } from './mail.js';
import type { Resources } from './resources.js';

/** Reuse the same mailbox, folder and access-profile checks as opening the email. */
export async function taskAssigneeContext(
  r: Resources,
  c: ReturnType<typeof requireTenant>,
  userId: string,
) {
  const member = await r.db
    .selectFrom('tenant_members as m')
    .leftJoin('access_profiles as p', (join) =>
      join.onRef('p.id', '=', 'm.access_profile_id').onRef('p.tenant_id', '=', 'm.tenant_id'),
    )
    .select([
      'm.role',
      'm.capabilities',
      'm.access_profile_id',
      'm.custom_permissions',
      'p.permissions',
    ])
    .where('m.tenant_id', '=', c.tenantId)
    .where('m.user_id', '=', userId)
    .where('m.status', '=', 'active')
    .executeTakeFirst();
  if (!member) throw notFound();
  const platform = await r.db
    .selectFrom('platform_admins')
    .select('user_id')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (platform) throw notFound();
  return {
    ...c,
    userId,
    tenantRole: member.role,
    capabilities: member.capabilities,
    accessProfileId: member.access_profile_id,
    accessRestricted: member.access_profile_id !== null || member.custom_permissions !== null,
    accessPermissions:
      member.custom_permissions ?? (member.access_profile_id ? (member.permissions ?? []) : null),
    mailboxRoles: new Map(),
  } satisfies RequestContext;
}

export async function validateTaskAssignment(
  r: Resources,
  c: ReturnType<typeof requireTenant>,
  threadId: string | null,
  userId: string,
) {
  if (userId !== c.userId && !isTenantAdmin(c.tenantRole)) throw forbidden();
  if (!threadId) {
    await taskAssigneeContext(r, c, userId);
    return;
  }
  await requireThread(c, r, threadId);
  await requireThread(await taskAssigneeContext(r, c, userId), r, threadId);
}

export async function registerEmailTasks(app: FastifyInstance, r: Resources) {
  app.get('/api/reminders/assignees', async (req) => {
    const c = requireTenant(req.ctx);
    if (!isTenantAdmin(c.tenantRole)) throw forbidden();
    return r.db
      .selectFrom('tenant_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.full_name'])
      .where('m.tenant_id', '=', c.tenantId)
      .where('m.status', '=', 'active')
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('platform_admins as p')
              .select('p.user_id')
              .whereRef('p.user_id', '=', 'u.id'),
          ),
        ),
      )
      .orderBy('u.full_name')
      .execute();
  });
  app.get('/api/threads/:id/tasks', async (req) => {
    const id = z.object({ id: z.uuid() }).parse(req.params).id;
    const { c } = await requireThread(req.ctx, r, id);
    return r.db
      .selectFrom('reminders as t')
      .innerJoin('users as u', 'u.id', 't.user_id')
      .selectAll('t')
      .select('u.full_name as assignee_name')
      .where('t.tenant_id', '=', c.tenantId)
      .where('t.thread_id', '=', id)
      .orderBy('t.due_at')
      .orderBy('t.id')
      .execute();
  });
  app.get('/api/threads/:id/task-assignees', async (req) => {
    const id = z.object({ id: z.uuid() }).parse(req.params).id;
    const { c } = await requireThread(req.ctx, r, id);
    if (!isTenantAdmin(c.tenantRole)) throw forbidden();
    const members = await r.db
      .selectFrom('tenant_members as m')
      .innerJoin('users as u', 'u.id', 'm.user_id')
      .select(['u.id', 'u.full_name'])
      .where('m.tenant_id', '=', c.tenantId)
      .where('m.status', '=', 'active')
      .orderBy('u.full_name')
      .execute();
    const allowed = [];
    for (const member of members) {
      try {
        await requireThread(await taskAssigneeContext(r, c, member.id), r, id);
        allowed.push(member);
      } catch (error) {
        if (!(error instanceof ApiError) || ![403, 404].includes(error.statusCode)) throw error;
      }
    }
    return allowed;
  });
}
