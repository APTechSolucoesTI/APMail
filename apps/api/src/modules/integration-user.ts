import { sql } from 'kysely';
import { isWithinAccessSchedule, profileAllowsMailbox } from '@apmail/shared';
import { ApiError } from '../authz/context.js';
import type { Resources } from './resources.js';

export async function integrationUser(
  db: Resources['db'],
  scope: { id: string; tenantId: string },
  email: string,
) {
  const user = await db
    .selectFrom('integration_api_token_users as s')
    .innerJoin('tenant_members as m', (j) =>
      j.onRef('m.tenant_id', '=', 's.tenant_id').onRef('m.user_id', '=', 's.user_id'),
    )
    .innerJoin('users as u', 'u.id', 'm.user_id')
    .innerJoin('tenants as t', 't.id', 'm.tenant_id')
    .leftJoin('access_profiles as p', (j) =>
      j.onRef('p.id', '=', 'm.access_profile_id').onRef('p.tenant_id', '=', 'm.tenant_id'),
    )
    .select([
      'u.id',
      'm.role',
      'm.access_schedule',
      't.timezone',
      sql<
        string[] | null
      >`case when m.custom_permissions is not null then m.custom_permissions when m.access_profile_id is not null then coalesce(p.permissions,array[]::text[]) else null end`.as(
        'permissions',
      ),
    ])
    .where('s.token_id', '=', scope.id)
    .where('s.tenant_id', '=', scope.tenantId)
    .where('u.email', '=', email.toLowerCase())
    .where('m.status', '=', 'active')
    .where('t.deleted_at', 'is', null)
    .where('t.suspended_at', 'is', null)
    .where(
      sql<boolean>`not exists(select 1 from platform_admins platform where platform.user_id=u.id)`,
    )
    .executeTakeFirst();
  if (
    !user ||
    !profileAllowsMailbox({ role: user.role, access_permissions: user.permissions }, 'read') ||
    !isWithinAccessSchedule(user.access_schedule, user.timezone)
  ) {
    throw new ApiError(
      404,
      'notification_scope_unavailable',
      'Consulta indisponível para o escopo desta integração.',
    );
  }
  return user;
}
