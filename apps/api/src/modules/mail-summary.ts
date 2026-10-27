import type { Resources } from './resources.js';
import { ApiError, requireTenant, type RequestContext } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';

/** Resolve access through the same role/profile guards used by individual mailboxes. */
export async function summaryMailboxIds(r: Resources, ctx: RequestContext) {
  const c = requireTenant(ctx);
  const boxes = await r.db
    .selectFrom('mailboxes')
    .select('id')
    .where('tenant_id', '=', c.tenantId)
    .where('deleted_at', 'is', null)
    .execute();
  const allowed = await Promise.all(
    boxes.map(async ({ id }) => {
      try {
        await requireMailboxPerm(c, r.db, id, 'read');
        return id;
      } catch (error) {
        if (error instanceof ApiError && [403, 404].includes(error.statusCode)) return null;
        throw error;
      }
    }),
  );
  return allowed.filter((id): id is string => id !== null);
}
