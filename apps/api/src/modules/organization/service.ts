import { isTenantAdmin } from '@apmail/shared';
import { sql } from 'kysely';
import { z } from 'zod';
import { asJson, type Database } from '@apmail/db';
import {
  can,
  mailRuleSchema,
  personalLabelSchema,
  toBullJobId,
  type MailRuleInput,
} from '@apmail/shared';
import {
  requireTenant,
  notFound,
  conflict,
  forbidden,
  type RequestContext,
} from '../../authz/context.js';
import { requireMailboxPerm } from '../../authz/guards.js';
import { requireFolder } from '../../authz/folders.js';
import { requireThread, mailEvents } from '../mail.js';
import type { Resources } from '../resources.js';
export const labelIdsSchema = z.object({ label_ids: z.array(z.uuid()).max(100) });
export const folderNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((s) => !/[\r\n\0/\\]/.test(s), 'Use um nome de pasta sem barras ou quebras de linha.'),
});
export async function validateLabelIds(
  r: Resources,
  c: ReturnType<typeof requireTenant>,
  ids: string[],
) {
  const unique = [...new Set(ids)];
  if (!unique.length) return unique;
  const rows = await r.db
    .selectFrom('personal_labels')
    .select('id')
    .where('tenant_id', '=', c.tenantId)
    .where('user_id', '=', c.userId)
    .where('id', 'in', unique)
    .execute();
  if (rows.length !== unique.length) throw notFound();
  return unique;
}
export async function replaceLabels(
  db: Database,
  c: ReturnType<typeof requireTenant>,
  threadIds: string[],
  labels: string[],
) {
  await db
    .deleteFrom('thread_personal_labels')
    .where('tenant_id', '=', c.tenantId)
    .where('user_id', '=', c.userId)
    .where('thread_id', 'in', threadIds)
    .execute();
  if (labels.length)
    await db
      .insertInto('thread_personal_labels')
      .values(
        threadIds.flatMap((thread_id) =>
          labels.map((label_id) => ({
            thread_id,
            label_id,
            tenant_id: c.tenantId,
            user_id: c.userId,
          })),
        ),
      )
      .onConflict((oc) => oc.columns(['thread_id', 'label_id']).doNothing())
      .execute();
}
export function organizationService(r: Resources) {
  const ownLabel = async (ctx: RequestContext | null, id: string) => {
    const c = requireTenant(ctx);
    const row = await r.db
      .selectFrom('personal_labels')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    if (!row) throw notFound();
    return { c, row };
  };
  const ownRule = async (ctx: RequestContext | null, id: string) => {
    const c = requireTenant(ctx);
    const row = await r.db
      .selectFrom('mail_rules')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!row || (row.scope === 'personal' && row.owner_user_id !== c.userId)) throw notFound();
    await requireMailboxPerm(c, r.db, row.mailbox_id, row.scope === 'personal' ? 'read' : 'rules');
    return { c, row };
  };
  const enqueueRule = async (id: string) => {
    await r.queues['rules-apply'].add(
      'apply',
      { rule_id: id, since_days: 30 },
      { jobId: toBullJobId('rule:' + id + ':' + Date.now()), attempts: 1 },
    );
  };
  const validateRule = async (c: ReturnType<typeof requireTenant>, b: MailRuleInput) => {
    await requireMailboxPerm(c, r.db, b.mailbox_id, b.scope === 'personal' ? 'read' : 'rules');
    for (const a of b.actions) {
      if (a.type === 'move_to_folder') {
        const f = await r.db
          .selectFrom('folders')
          .select('id')
          .where('id', '=', a.folder_id)
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', b.mailbox_id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (!f) throw notFound();
        await requireFolder(c, r.db, b.mailbox_id, f.id);
      } else if (a.type === 'add_label') await validateLabelIds(r, c, [a.label_id]);
      else if (a.type === 'assign_to') {
        const target = await r.db
          .selectFrom('tenant_members as tm')
          .leftJoin('mailbox_members as mm', (j) =>
            j
              .onRef('mm.user_id', '=', 'tm.user_id')
              .onRef('mm.tenant_id', '=', 'tm.tenant_id')
              .on('mm.mailbox_id', '=', b.mailbox_id),
          )
          .select(['tm.role', 'mm.role as mailbox_role'])
          .where('tm.user_id', '=', a.user_id)
          .where('tm.tenant_id', '=', c.tenantId)
          .where('tm.status', '=', 'active')
          .executeTakeFirst();
        if (!target || (!isTenantAdmin(target.role) && !can(target.mailbox_role, 'send')))
          throw conflict('O responsável precisa poder enviar nesta caixa.');
      } else if (a.type === 'forward_to') {
        const tenant = await r.db
          .selectFrom('tenants')
          .select('settings')
          .where('id', '=', c.tenantId)
          .executeTakeFirstOrThrow();
        if (
          !(tenant.settings as { allow_external_auto_forward?: boolean })
            .allow_external_auto_forward
        )
          throw forbidden();
      }
    }
  };
  const folderAction = async (
    ctx: RequestContext | null,
    kind: 'create_folder' | 'rename_folder' | 'delete_folder',
    id: string,
    input: unknown,
  ) => {
    const c = requireTenant(ctx);
    let mailboxId = id,
      payload: Record<string, unknown>;
    if (kind === 'create_folder') {
      const b = folderNameSchema
        .extend({ parent_id: z.uuid().nullable().default(null) })
        .parse(input);
      await requireMailboxPerm(c, r.db, id, 'organize');
      const parent = b.parent_id
        ? await r.db
            .selectFrom('folders')
            .selectAll()
            .where('id', '=', b.parent_id)
            .where('tenant_id', '=', c.tenantId)
            .where('mailbox_id', '=', id)
            .where('deleted_at', 'is', null)
            .executeTakeFirst()
        : null;
      if (b.parent_id && !parent) throw notFound();
      const root = await r.db
        .selectFrom('folders')
        .select('delimiter')
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', id)
        .where('special_use', '=', 'inbox')
        .executeTakeFirst();
      const delimiter = parent?.delimiter ?? root?.delimiter ?? '/';
      if (b.name.includes(delimiter))
        throw conflict('O nome não pode conter o separador de pastas.');
      const path = parent ? parent.imap_path + delimiter + b.name : b.name;
      const exists = await r.db
        .selectFrom('folders')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', id)
        .where('imap_path', '=', path)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (exists) throw conflict('Já existe uma pasta com este nome.');
      payload = { name: b.name, parent_id: b.parent_id, imap_path: path };
    } else {
      const folder = await r.db
        .selectFrom('folders')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!folder) throw notFound();
      mailboxId = folder.mailbox_id;
      await requireMailboxPerm(c, r.db, mailboxId, 'organize');
      if (folder.special_use) throw conflict('Pastas especiais não podem ser alteradas.');
      if (kind === 'delete_folder') {
        const msg = await r.db
          .selectFrom('messages')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where('folder_id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        const child = await r.db
          .selectFrom('folders')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where('parent_id', '=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (msg || child)
          throw conflict('Esvazie a pasta e remova suas subpastas antes de excluir.');
        payload = { folder_id: id };
      } else {
        const b = folderNameSchema.parse(input);
        if (folder.delimiter && b.name.includes(folder.delimiter))
          throw conflict('O nome não pode conter o separador de pastas.');
        const parent = folder.parent_id
          ? await r.db
              .selectFrom('folders')
              .select('imap_path')
              .where('id', '=', folder.parent_id)
              .where('tenant_id', '=', c.tenantId)
              .executeTakeFirst()
          : null;
        const path = parent ? parent.imap_path + (folder.delimiter ?? '/') + b.name : b.name;
        const existing = await r.db
          .selectFrom('folders')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', mailboxId)
          .where('imap_path', '=', path)
          .where('id', '!=', id)
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (existing) throw conflict('Já existe uma pasta com este nome.');
        payload = { folder_id: id, name: b.name, imap_path: path };
      }
    }
    const box = await r.db
      .selectFrom('mailboxes')
      .select('status')
      .where('id', '=', mailboxId)
      .where('tenant_id', '=', c.tenantId)
      .executeTakeFirstOrThrow();
    if (box.status !== 'active') throw conflict('Reconecte a caixa antes de alterar pastas.');
    const row = await r.db
      .insertInto('mail_actions')
      .values({
        tenant_id: c.tenantId,
        mailbox_id: mailboxId,
        requested_by: c.userId,
        type: kind,
        payload: asJson(payload),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await r.queues['mail-actions'].add(
      'action',
      { action_id: row.id },
      {
        jobId: toBullJobId('action:' + row.id),
        attempts: 3,
        backoff: { type: 'exponential', delay: 10000 },
      },
    );
    return { action_id: row.id };
  };
  return {
    folderAction,
    labels: async (ctx: RequestContext | null) => {
      const c = requireTenant(ctx);
      return r.db
        .selectFrom('personal_labels as l')
        .selectAll('l')
        .select(
          sql<number>`(select count(*)::int from thread_personal_labels tl join threads t on t.id=tl.thread_id where tl.label_id=l.id and tl.tenant_id=${c.tenantId} and tl.user_id=${c.userId} and t.deleted_at is null and (exists(select 1 from mailbox_members mm where mm.mailbox_id=t.mailbox_id and mm.user_id=${c.userId}) or ${isTenantAdmin(c.tenantRole)}))`.as(
            'thread_count',
          ),
        )
        .where('l.tenant_id', '=', c.tenantId)
        .where('l.user_id', '=', c.userId)
        .orderBy('l.name')
        .execute();
    },
    saveLabel: async (ctx: RequestContext | null, id: string | null, body: unknown) => {
      const c = id ? (await ownLabel(ctx, id)).c : requireTenant(ctx);
      const b = personalLabelSchema.parse(body);
      const duplicate = await r.db
        .selectFrom('personal_labels')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .where('name', '=', b.name)
        .where('id', '!=', id ?? '00000000-0000-0000-0000-000000000000')
        .executeTakeFirst();
      if (duplicate) throw conflict('Você já tem uma etiqueta com este nome.');
      const row = id
        ? await r.db
            .updateTable('personal_labels')
            .set(b)
            .where('id', '=', id)
            .where('tenant_id', '=', c.tenantId)
            .where('user_id', '=', c.userId)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await r.db
            .insertInto('personal_labels')
            .values({ ...b, tenant_id: c.tenantId, user_id: c.userId })
            .returningAll()
            .executeTakeFirstOrThrow();
      r.io.to('user:' + c.userId).emit('mailboxes:changed', {});
      return row;
    },
    deleteLabel: async (ctx: RequestContext | null, id: string) => {
      const { c } = await ownLabel(ctx, id);
      await r.db
        .deleteFrom('personal_labels')
        .where('id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .execute();
      r.io.to('user:' + c.userId).emit('mailboxes:changed', {});
    },
    threadLabels: async (ctx: RequestContext | null, id: string, body: unknown) => {
      const { c, thread } = await requireThread(ctx, r, id);
      const labels = await validateLabelIds(r, c, labelIdsSchema.parse(body).label_ids);
      await r.db.transaction().execute((tx) => replaceLabels(tx, c, [id], labels));
      mailEvents(r, thread.mailbox_id, [id], c.userId);
      return { updated: 1 };
    },
    rules: async (ctx: RequestContext | null, query: unknown) => {
      const c = requireTenant(ctx),
        q = z
          .object({
            scope: z.enum(['personal', 'mailbox']).default('personal'),
            mailbox_id: z.uuid().optional(),
          })
          .parse(query);
      let rows = r.db
        .selectFrom('mail_rules')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('scope', '=', q.scope)
        .where('deleted_at', 'is', null);
      if (q.scope === 'personal') rows = rows.where('owner_user_id', '=', c.userId);
      if (q.mailbox_id) {
        await requireMailboxPerm(c, r.db, q.mailbox_id, q.scope === 'personal' ? 'read' : 'rules');
        rows = rows.where('mailbox_id', '=', q.mailbox_id);
      }
      const result = await rows.orderBy('priority').orderBy('created_at').execute();
      const visible = [];
      for (const row of result) {
        try {
          await requireMailboxPerm(
            c,
            r.db,
            row.mailbox_id,
            q.scope === 'personal' ? 'read' : 'rules',
          );
          visible.push(row);
        } catch {
          /* Caixas sem permissão não são reveladas. */
        }
      }
      return visible;
    },
    saveRule: async (ctx: RequestContext | null, id: string | null, body: unknown) => {
      const own = id ? await ownRule(ctx, id) : null,
        c = own?.c ?? requireTenant(ctx),
        raw = z.record(z.string(), z.unknown()).parse(body),
        b = mailRuleSchema.parse({ ...own?.row, ...raw });
      if (own && (b.scope !== own.row.scope || b.mailbox_id !== own.row.mailbox_id))
        throw conflict('O escopo e a caixa de uma regra existente não podem ser trocados.');
      await validateRule(c, b);
      const { id: unused, ...input } = b;
      void unused;
      const values = { ...input, conditions: asJson(b.conditions), actions: asJson(b.actions) };
      const row = id
        ? await r.db
            .updateTable('mail_rules')
            .set(values)
            .where('id', '=', id)
            .where('tenant_id', '=', c.tenantId)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await r.db
            .insertInto('mail_rules')
            .values({
              ...values,
              tenant_id: c.tenantId,
              owner_user_id: b.scope === 'personal' ? c.userId : null,
              created_by: c.userId,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
      if (z.boolean().default(false).parse(raw.apply_existing)) await enqueueRule(row.id);
      return row;
    },
    deleteRule: async (ctx: RequestContext | null, id: string) => {
      const { c } = await ownRule(ctx, id);
      await r.db
        .updateTable('mail_rules')
        .set({ deleted_at: new Date() })
        .where('id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .execute();
    },
  };
}
