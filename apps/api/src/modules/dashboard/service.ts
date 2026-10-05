import { isTenantAdmin } from '@apmail/shared';
import { readableFolders } from '../../authz/folders.js';
import { z } from 'zod';
import { dashboardQuerySchema } from '@apmail/shared';
import { requireTenant, forbidden, type RequestContext } from '../../authz/context.js';
import { requireMailboxPerm } from '../../authz/guards.js';
import type { Resources } from '../resources.js';
export type DashboardScope = {
  tenantId: string;
  boxIds: string[];
  timezone: string;
  from: string;
  to: string;
  filtered: boolean;
  userId: string | null;
  sla: number;
  limit: number;
  folderScopes: { mailboxId: string; folders: string[] | null }[];
};
export async function dashboardScope(
  r: Resources,
  ctx: RequestContext | null,
  input: unknown,
): Promise<DashboardScope> {
  const c = requireTenant(ctx),
    q = dashboardQuerySchema.parse(input),
    tenant = await r.db
      .selectFrom('tenants')
      .select(['timezone', 'settings'])
      .where('id', '=', c.tenantId)
      .executeTakeFirstOrThrow();
  if (q.mailbox_id) await requireMailboxPerm(c, r.db, q.mailbox_id, 'read');
  const personal = c.tenantRole === 'member';
  if (personal && q.user_id && q.user_id !== c.userId) throw forbidden();
  let boxes = r.db
    .selectFrom('mailboxes as b')
    .select('b.id')
    .where('b.tenant_id', '=', c.tenantId)
    .where('b.deleted_at', 'is', null);
  if (q.mailbox_id) boxes = boxes.where('b.id', '=', q.mailbox_id);
  else if (!isTenantAdmin(c.tenantRole))
    boxes = boxes.where((eb) =>
      eb.exists(
        eb
          .selectFrom('mailbox_members as mm')
          .select('mm.id')
          .whereRef('mm.mailbox_id', '=', 'b.id')
          .where('mm.tenant_id', '=', c.tenantId)
          .where('mm.user_id', '=', c.userId),
      ),
    );
  const ids = (await boxes.execute()).map((b) => b.id);
  if (q.user_id && !personal) {
    const member = await r.db
      .selectFrom('tenant_members')
      .select('user_id')
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', q.user_id)
      .where((eb) =>
        eb.or([
          eb('role', 'in', ['owner', 'admin']),
          eb.exists(
            eb
              .selectFrom('mailbox_members as mm')
              .select('mm.id')
              .where('mm.tenant_id', '=', c.tenantId)
              .where('mm.user_id', '=', q.user_id!)
              .where(
                'mm.mailbox_id',
                'in',
                ids.length ? ids : ['00000000-0000-0000-0000-000000000000'],
              ),
          ),
        ]),
      )
      .executeTakeFirst();
    if (!member) throw forbidden();
  }
  const folderScopes = await Promise.all(
    ids.map(async (mailboxId) => ({
      mailboxId,
      folders: await readableFolders(c, r.db, mailboxId),
    })),
  );
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: tenant.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const to = q.to ?? today,
    from =
      q.from ??
      new Date(new Date(to + 'T12:00:00Z').getTime() - 29 * 86400000).toISOString().slice(0, 10);
  z.object({ from: z.iso.date(), to: z.iso.date() })
    .refine((x) => x.from <= x.to, {
      message: 'O início deve ser anterior ao fim.',
      path: ['from'],
    })
    .refine((x) => (new Date(x.to).getTime() - new Date(x.from).getTime()) / 86400000 <= 365, {
      message: 'Escolha um intervalo de até 366 dias.',
      path: ['to'],
    })
    .parse({ from, to });
  return {
    tenantId: c.tenantId,
    boxIds: ids,
    timezone: tenant.timezone,
    from,
    to,
    filtered: !!q.mailbox_id,
    userId: personal ? c.userId : (q.user_id ?? null),
    sla: Number(
      (tenant.settings as { sla_first_response_hours?: number }).sla_first_response_hours ?? 24,
    ),
    limit: q.limit,
    folderScopes,
  };
}
