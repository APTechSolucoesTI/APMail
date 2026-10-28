import { isWithinAccessSchedule } from '@apmail/shared';
import type { DB } from '@apmail/db';
import type { Kysely } from 'kysely';
import { ApiError } from './context.js';

export const outsideSchedule = () =>
  new ApiError(
    403,
    'outside_access_schedule',
    'Seu acesso está fora do horário permitido pela empresa. Entre novamente no próximo expediente ou solicite uma exceção ao administrador.',
  );
export async function assertTenantAccessSchedule(
  db: Kysely<DB>,
  userId: string,
  tenantId: string,
  now = new Date(),
) {
  const member = await db
    .selectFrom('tenant_members as m')
    .innerJoin('tenants as t', 't.id', 'm.tenant_id')
    .select(['m.access_schedule', 't.timezone'])
    .where('m.user_id', '=', userId)
    .where('m.tenant_id', '=', tenantId)
    .where('m.status', '=', 'active')
    .executeTakeFirst();
  if (member && !isWithinAccessSchedule(member.access_schedule, member.timezone, now))
    throw outsideSchedule();
}
export async function assertLoginAccessSchedule(db: Kysely<DB>, userId: string) {
  const platform = await db
    .selectFrom('platform_admins')
    .select('user_id')
    .where('user_id', '=', userId)
    .executeTakeFirst();
  if (platform) return;
  const user = await db
    .selectFrom('users')
    .select('current_tenant_id')
    .where('id', '=', userId)
    .executeTakeFirstOrThrow();
  if (user.current_tenant_id) await assertTenantAccessSchedule(db, userId, user.current_tenant_id);
}
