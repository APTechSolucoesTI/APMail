import type { FastifyInstance } from 'fastify';
import { asJson } from '@apmail/db';
import { sql } from 'kysely';
import {
  compositionFormatSchema,
  compositionPreferenceSchema,
  DEFAULT_COMPOSITION_FORMAT,
  isTenantAdmin,
  profileAllowsMailbox,
} from '@apmail/shared';
import { requireTenant } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from './resources.js';

export async function registerCompositionPreferences(app: FastifyInstance, r: Resources) {
  app.get('/api/preferences/composition', async (req) => {
    const c = requireTenant(req.ctx);
    const preference = await r.db
      .selectFrom('user_preferences')
      .select('composition_format')
      .where('user_id', '=', c.userId)
      .executeTakeFirstOrThrow();
    const allowed =
      !c.accessProfileId ||
      profileAllowsMailbox({ role: c.tenantRole, access_permissions: c.accessPermissions }, 'read');
    const rows = allowed
      ? await r.db
          .selectFrom('mailbox_composition_preferences as p')
          .innerJoin('mailboxes as m', 'm.id', 'p.mailbox_id')
          .select(['p.mailbox_id', 'p.format'])
          .where('p.tenant_id', '=', c.tenantId)
          .where('p.user_id', '=', c.userId)
          .where('m.deleted_at', 'is', null)
          .where(
            sql<boolean>`${isTenantAdmin(c.tenantRole)} or exists(select 1 from mailbox_members mm where mm.tenant_id=p.tenant_id and mm.mailbox_id=p.mailbox_id and mm.user_id=p.user_id)`,
          )
          .execute()
      : [];
    const overrides = rows.map((row) => ({
      mailbox_id: row.mailbox_id,
      format: compositionFormatSchema.parse(row.format),
    }));
    return {
      default_format: compositionFormatSchema.parse(
        preference.composition_format ?? DEFAULT_COMPOSITION_FORMAT,
      ),
      overrides,
    };
  });
  app.put('/api/preferences/composition', async (req) => {
    const c = requireTenant(req.ctx),
      body = compositionPreferenceSchema.parse(req.body);
    if (body.mailbox_id) {
      await requireMailboxPerm(c, r.db, body.mailbox_id, 'read');
      if (body.format)
        await r.db
          .insertInto('mailbox_composition_preferences')
          .values({
            tenant_id: c.tenantId,
            user_id: c.userId,
            mailbox_id: body.mailbox_id,
            format: asJson(body.format),
          })
          .onConflict((oc) =>
            oc
              .columns(['tenant_id', 'user_id', 'mailbox_id'])
              .doUpdateSet({ format: asJson(body.format), updated_at: new Date() }),
          )
          .execute();
      else
        await r.db
          .deleteFrom('mailbox_composition_preferences')
          .where('tenant_id', '=', c.tenantId)
          .where('user_id', '=', c.userId)
          .where('mailbox_id', '=', body.mailbox_id)
          .execute();
    } else
      await r.db
        .updateTable('user_preferences')
        .set({ composition_format: body.format ? asJson(body.format) : null })
        .where('user_id', '=', c.userId)
        .execute();
    return { ok: true };
  });
}
