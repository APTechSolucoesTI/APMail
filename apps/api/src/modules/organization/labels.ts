import { sql } from 'kysely';
import { z } from 'zod';
import { audit, lockStorageTenant, type Database } from '@apmail/db';
import { personalLabelSchema, isTenantAdmin } from '@apmail/shared';
import {
  requireTenant,
  notFound,
  forbidden,
  conflict,
  type RequestContext,
} from '../../authz/context.js';
import { requireThread, mailEvents } from '../mail.js';
import type { Resources } from '../resources.js';
type Context = ReturnType<typeof requireTenant>;
export const labelIdsSchema = z.object({
  label_ids: z.array(z.uuid()).max(100),
  global_add: z.array(z.uuid()).max(100).default([]),
  global_remove: z.array(z.uuid()).max(100).default([]),
});
export async function validateLabelIds(r: Resources, c: Context, ids: string[]) {
  const unique = [...new Set(ids)];
  if (!unique.length) return unique;
  const rows = await r.db
    .selectFrom('personal_labels')
    .select('id')
    .where('tenant_id', '=', c.tenantId)
    .where((eb) => eb.or([eb('scope', '=', 'tenant'), eb('user_id', '=', c.userId)]))
    .where('id', 'in', unique)
    .execute();
  if (rows.length !== unique.length) throw notFound();
  return unique;
}
export async function replaceLabels(
  db: Database,
  c: Context,
  threadIds: string[],
  ids: string[],
  globalAdd: string[] = [],
  globalRemove: string[] = [],
) {
  await lockStorageTenant(db, c.tenantId);
  const all = [...new Set([...ids, ...globalAdd, ...globalRemove])];
  const labels = all.length
    ? await db
        .selectFrom('personal_labels')
        .select(['id', 'scope', 'user_id'])
        .where('tenant_id', '=', c.tenantId)
        .where('id', 'in', all)
        .where((eb) => eb.or([eb('scope', '=', 'tenant'), eb('user_id', '=', c.userId)]))
        .execute()
    : [];
  if (labels.length !== all.length) throw notFound();
  if (
    [...globalAdd, ...globalRemove].some(
      (id) => !labels.some((l) => l.id === id && l.scope === 'tenant'),
    ) ||
    globalAdd.some((id) => globalRemove.includes(id))
  )
    throw conflict('A alteração das etiquetas globais é inválida.');
  // Personal replacement cannot touch another owner or shared selections.
  await db
    .deleteFrom('thread_personal_labels')
    .where('tenant_id', '=', c.tenantId)
    .where('user_id', '=', c.userId)
    .where('thread_id', 'in', threadIds)
    .execute();
  if (globalRemove.length)
    await db
      .deleteFrom('thread_personal_labels')
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', 'is', null)
      .where('thread_id', 'in', threadIds)
      .where('label_id', 'in', globalRemove)
      .execute();
  const applying = labels.filter((l) =>
    l.scope === 'personal' ? ids.includes(l.id) : globalAdd.includes(l.id),
  );
  if (applying.length)
    await db
      .insertInto('thread_personal_labels')
      .values(
        threadIds.flatMap((thread_id) =>
          applying.map((l) => ({
            tenant_id: c.tenantId,
            thread_id,
            label_id: l.id,
            user_id: l.user_id,
            applied_by: c.userId,
          })),
        ),
      )
      .onConflict((oc) => oc.columns(['thread_id', 'label_id']).doNothing())
      .execute();
  if (globalAdd.length || globalRemove.length)
    await audit(db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action: 'labels.applied',
      entityType: 'thread',
      metadata: { thread_ids: threadIds, added: globalAdd, removed: globalRemove },
      ip: c.ip,
    });
}
export function labelsService(r: Resources) {
  async function own(ctx: RequestContext | null, id: string) {
    const c = requireTenant(ctx),
      row = await r.db
        .selectFrom('personal_labels')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', id)
        .where((eb) => eb.or([eb('scope', '=', 'tenant'), eb('user_id', '=', c.userId)]))
        .executeTakeFirst();
    if (!row) throw notFound();
    if (row.scope === 'tenant' && !isTenantAdmin(c.tenantRole)) throw forbidden();
    return { c, row };
  }
  const changed = (c: Context, scope: string) =>
    r.io
      .to(scope === 'tenant' ? 'tenant:' + c.tenantId : 'user:' + c.userId)
      .emit('mailboxes:changed', {});
  return {
    labels: async (ctx: RequestContext | null) => {
      const c = requireTenant(ctx);
      // Apply folder grants before counts; never leak hidden conversations via labels.
      const result = await sql`with recursive boxes as (
        select b.id,(${isTenantAdmin(c.tenantRole)} or mm.role='mailbox_admin' or not mm.restrict_to_folders) as full_access
        from mailboxes b left join mailbox_members mm on mm.mailbox_id=b.id and mm.tenant_id=b.tenant_id and mm.user_id=${c.userId}
        where b.tenant_id=${c.tenantId} and b.deleted_at is null and (${isTenantAdmin(c.tenantRole)} or mm.user_id is not null)
      ), permitted as (
        select f.id,f.mailbox_id from folders f join boxes b on b.id=f.mailbox_id where f.tenant_id=${c.tenantId} and f.deleted_at is null
        and (b.full_access or exists(select 1 from folder_permissions p where p.folder_id=f.id and p.mailbox_id=f.mailbox_id and p.tenant_id=f.tenant_id and p.user_id=${c.userId}))
        union select f.id,f.mailbox_id from folders f join permitted p on p.id=f.parent_id and p.mailbox_id=f.mailbox_id where f.tenant_id=${c.tenantId} and f.deleted_at is null
      ), visible as (
        select distinct m.thread_id from messages m join boxes b on b.id=m.mailbox_id join threads t on t.id=m.thread_id and t.tenant_id=m.tenant_id
        where m.tenant_id=${c.tenantId} and m.deleted_at is null and t.deleted_at is null and (b.full_access or exists(select 1 from permitted p where p.id=m.folder_id and p.mailbox_id=m.mailbox_id))
      ) select l.id,l.name,l.color,l.scope,l.user_id,(select count(*)::int from thread_personal_labels tl join visible v on v.thread_id=tl.thread_id where tl.label_id=l.id and tl.tenant_id=l.tenant_id) as thread_count
      from personal_labels l where l.tenant_id=${c.tenantId} and (l.scope='tenant' or l.user_id=${c.userId}) order by l.name,l.id`.execute(
        r.db,
      );
      return result.rows;
    },
    saveLabel: async (ctx: RequestContext | null, id: string | null, body: unknown) => {
      const existing = id ? await own(ctx, id) : null,
        c = existing?.c ?? requireTenant(ctx);
      const b = personalLabelSchema.parse({
        ...existing?.row,
        ...z.record(z.string(), z.unknown()).parse(body),
      });
      if (existing && b.scope !== existing.row.scope)
        throw conflict('O tipo de uma etiqueta existente não pode ser alterado.');
      if (b.scope === 'tenant' && !isTenantAdmin(c.tenantRole)) throw forbidden();
      const row = await r.db.transaction().execute(async (tx) => {
        await lockStorageTenant(tx, c.tenantId);
        const duplicate = await tx
          .selectFrom('personal_labels')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where('scope', '=', b.scope)
          .where(
            'user_id',
            b.scope === 'personal' ? '=' : 'is',
            b.scope === 'personal' ? c.userId : null,
          )
          .where(sql<boolean>`lower(regexp_replace(btrim(name),'\\s+',' ','g'))=lower(${b.name})`)
          .$if(!!id, (q) => q.where('id', '!=', id!))
          .executeTakeFirst();
        if (duplicate) throw conflict('Já existe uma etiqueta com este nome neste tipo.');
        const result = id
          ? await tx
              .updateTable('personal_labels')
              .set({ name: b.name, color: b.color })
              .where('id', '=', id)
              .where('tenant_id', '=', c.tenantId)
              .returningAll()
              .executeTakeFirstOrThrow()
          : await tx
              .insertInto('personal_labels')
              .values({
                ...b,
                tenant_id: c.tenantId,
                user_id: b.scope === 'personal' ? c.userId : null,
                created_by: c.userId,
              })
              .returningAll()
              .executeTakeFirstOrThrow();
        if (b.scope === 'tenant')
          await audit(tx, {
            tenantId: c.tenantId,
            actorId: c.userId,
            action: id ? 'label.updated' : 'label.created',
            entityType: 'label',
            entityId: result.id,
            metadata: { name: b.name, color: b.color },
            ip: c.ip,
          });
        return result;
      });
      changed(c, b.scope);
      return row;
    },
    deleteLabel: async (ctx: RequestContext | null, id: string) => {
      const { c, row } = await own(ctx, id);
      await r.db.transaction().execute(async (tx) => {
        await lockStorageTenant(tx, c.tenantId);
        await tx
          .deleteFrom('personal_labels')
          .where('tenant_id', '=', c.tenantId)
          .where('id', '=', id)
          .execute();
        if (row.scope === 'tenant')
          await audit(tx, {
            tenantId: c.tenantId,
            actorId: c.userId,
            action: 'label.deleted',
            entityType: 'label',
            entityId: id,
            ip: c.ip,
          });
      });
      changed(c, row.scope);
    },
    threadLabels: async (ctx: RequestContext | null, id: string, body: unknown) => {
      const { c, thread } = await requireThread(ctx, r, id),
        b = labelIdsSchema.parse(body);
      await validateLabelIds(r, c, [...b.label_ids, ...b.global_add, ...b.global_remove]);
      await r.db
        .transaction()
        .execute((tx) => replaceLabels(tx, c, [id], b.label_ids, b.global_add, b.global_remove));
      mailEvents(r, thread.mailbox_id, [id], c.userId);
      if (b.global_add.length || b.global_remove.length)
        r.io.to('tenant:' + c.tenantId).emit('labels:changed', {});
      return { updated: 1 };
    },
  };
}
