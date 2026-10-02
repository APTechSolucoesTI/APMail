import { isTenantAdmin } from '@apmail/shared';
import type { Kysely } from 'kysely';
import type { DB } from '@apmail/db';
import { can, canDelegate, type MailboxPerm, type MailboxRole } from '@apmail/shared';
import { requireTenant, notFound, forbidden, type RequestContext } from './context.js';
export async function getMailboxRole(
  ctx: RequestContext,
  db: Kysely<DB>,
  id: string,
): Promise<MailboxRole | null> {
  const c = requireTenant(ctx);
  if (c.mailboxRoles.has(id)) return c.mailboxRoles.get(id) ?? null;
  const mailbox = await db
    .selectFrom('mailboxes')
    .select('id')
    .where('id', '=', id)
    .where('tenant_id', '=', c.tenantId)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  let role: MailboxRole | null = null;
  if (mailbox) {
    if (isTenantAdmin(c.tenantRole)) role = 'mailbox_admin';
    else
      role =
        (
          await db
            .selectFrom('mailbox_members')
            .select('role')
            .where('tenant_id', '=', c.tenantId)
            .where('mailbox_id', '=', id)
            .where('user_id', '=', c.userId)
            .executeTakeFirst()
        )?.role ?? null;
  }
  c.mailboxRoles.set(id, role);
  return role;
}
export async function requireMailboxPerm(
  ctx: RequestContext,
  db: Kysely<DB>,
  id: string,
  perm: MailboxPerm,
) {
  const role = await getMailboxRole(ctx, db, id);
  if (!role) throw notFound();
  if (!can(role, perm) && !canDelegate(ctx.tenantRole, ctx.capabilities, perm)) throw forbidden();
  return role;
}
