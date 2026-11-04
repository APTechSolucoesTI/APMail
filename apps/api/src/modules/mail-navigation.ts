import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asJson } from '@apmail/db';
import { requireTenant, conflict, notFound } from '../authz/context.js';
import { getMailboxRole, requireMailboxPerm } from '../authz/guards.js';
import { folderPredicate, readableFolders, requireFolder } from '../authz/folders.js';
import type { Resources } from './resources.js';

const ids = z
  .array(z.uuid())
  .max(10000)
  .refine((v) => new Set(v).size === v.length);
const domains = z
  .array(z.string().min(1).max(253))
  .max(10000)
  .refine((values) => new Set(values).size === values.length);
const configSchema = z.object({
  domain_order: domains.default([]),
  mailbox_order: ids.default([]),
  folder_orders: z.record(z.string().max(100), ids).default({}),
  favorite_folder_ids: ids.default([]),
});
const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('domains'), ids: domains }),
  z.object({ type: z.literal('mailboxes'), ids }),
  z.object({
    type: z.literal('folders'),
    mailbox_id: z.uuid(),
    parent_id: z.uuid().nullable(),
    ids,
  }),
  z.object({
    type: z.literal('favorite'),
    mailbox_id: z.uuid(),
    folder_id: z.uuid(),
    value: z.boolean(),
  }),
]);
export async function registerMailNavigation(app: FastifyInstance, r: Resources) {
  app.get('/api/preferences/mail-navigation', async (req) => {
    const c = requireTenant(req.ctx);
    const row = await r.db
      .selectFrom('mail_navigation_preferences')
      .select('config')
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    return configSchema.parse(row?.config ?? {});
  });
  app.patch('/api/preferences/mail-navigation', async (req) => {
    const c = requireTenant(req.ctx),
      action = actionSchema.parse(req.body);
    if (action.type === 'domains') {
      const mailboxes = await r.db
        .selectFrom('mailboxes')
        .select(['id', 'email_address'])
        .where('tenant_id', '=', c.tenantId)
        .where('deleted_at', 'is', null)
        .execute();
      const allowed = new Set<string>();
      for (const mailbox of mailboxes) {
        if (await getMailboxRole(c, r.db, mailbox.id))
          allowed.add(mailbox.email_address.split('@')[1]?.toLowerCase() ?? 'Outras caixas');
      }
      if (action.ids.some((domain) => !allowed.has(domain))) throw notFound();
    } else if (action.type === 'mailboxes') {
      for (const id of action.ids) if (!(await getMailboxRole(c, r.db, id))) throw notFound();
    } else {
      await requireMailboxPerm(c, r.db, action.mailbox_id, 'read');
      if (action.type === 'favorite') {
        const folder = await r.db
          .selectFrom('folders')
          .select('id')
          .where('id', '=', action.folder_id)
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', action.mailbox_id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (!folder) throw notFound();
        await requireFolder(c, r.db, action.mailbox_id, folder.id);
      } else {
        const scope = await readableFolders(c, r.db, action.mailbox_id);
        const siblings = await r.db
          .selectFrom('folders')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', action.mailbox_id)
          .where('deleted_at', 'is', null)
          .where('parent_id', action.parent_id ? '=' : 'is', action.parent_id)
          .where(folderPredicate(scope, 'id'))
          .execute();
        const allowed = new Set(siblings.map((f) => f.id));
        if (action.ids.length !== allowed.size || action.ids.some((id) => !allowed.has(id)))
          throw conflict(
            'Reordene somente as pastas do mesmo nível. Atualize a lista e tente novamente.',
          );
      }
    }
    return r.db.transaction().execute(async (tx) => {
      await tx
        .insertInto('mail_navigation_preferences')
        .values({ tenant_id: c.tenantId, user_id: c.userId })
        .onConflict((oc) => oc.columns(['tenant_id', 'user_id']).doNothing())
        .execute();
      const row = await tx
        .selectFrom('mail_navigation_preferences')
        .select('config')
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      const config = configSchema.parse(row.config);
      if (action.type === 'domains') config.domain_order = action.ids;
      else if (action.type === 'mailboxes') config.mailbox_order = action.ids;
      else if (action.type === 'folders')
        config.folder_orders[action.mailbox_id + ':' + (action.parent_id ?? 'root')] = action.ids;
      else
        config.favorite_folder_ids = action.value
          ? [...new Set([...config.favorite_folder_ids, action.folder_id])]
          : config.favorite_folder_ids.filter((id) => id !== action.folder_id);
      await tx
        .updateTable('mail_navigation_preferences')
        .set({ config: asJson(config) })
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .execute();
      return config;
    });
  });
}
