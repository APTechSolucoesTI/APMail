import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { audit, asJson, lockStorageTenant } from '@apmail/db';
import {
  tenantQuotaSchema,
  allocationSchema,
  type MailboxQuota,
  type TenantQuota,
} from '@apmail/shared';
import {
  requireSuperAdmin,
  requireTenant,
  requireTenantAdmin,
  notFound,
  conflict,
} from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import type { Resources } from './resources.js';

export async function readMailboxQuotas(r: Resources, tenant: string, id?: string) {
  return (
    await sql<
      MailboxQuota & { provider_identity: string | null }
    >`select b.id as mailbox_id,b.tenant_id,b.name,b.email_address,
    storage_quota_usage(b.tenant_id,b.id)::text as used_bytes,l.allocated_bytes::text,
    l.paused_at,l.sync_checkpoint,coalesce(l.provider_status,'pending') as provider_status,
    l.provider_used_bytes::text,l.provider_limit_bytes::text,l.provider_identity,l.provider_checked_at
    from mailboxes b left join mailbox_storage_limits l on l.mailbox_id=b.id
    where b.tenant_id=${tenant}::uuid and b.deleted_at is null and (${id ?? null}::uuid is null or b.id=${id ?? null}::uuid)
    order by b.name,b.id`.execute(r.db)
  ).rows;
}
async function readTenantQuota(r: Resources, tenant: string): Promise<TenantQuota> {
  if (!r.db.isTransaction)
    return r.db
      .transaction()
      .setIsolationLevel('repeatable read')
      .execute((tx) => readTenantQuota({ ...r, db: tx }, tenant));
  const row = (
    await sql<
      Omit<
        TenantQuota,
        'provider' | 'mailboxes' | 'shared_bytes' | 'allocated_bytes' | 'remaining_allocation_bytes'
      >
    >`select t.id as tenant_id,l.max_mailboxes,l.storage_limit_bytes::text,
    coalesce(l.allocation_mode,'equal') as allocation_mode,storage_quota_usage(t.id)::text as used_bytes
    from tenants t left join tenant_storage_limits l on l.tenant_id=t.id where t.id=${tenant}::uuid and t.deleted_at is null`.execute(
      r.db,
    )
  ).rows[0];
  if (!row) throw notFound();
  const boxes = await readMailboxQuotas(r, tenant),
    known = boxes.filter(
      (b) =>
        b.provider_status === 'available' &&
        b.provider_used_bytes !== null &&
        b.provider_limit_bytes !== null,
    );
  const roots = new Map<string, (typeof known)[number]>();
  for (const b of known) {
    const key = b.provider_identity ?? b.mailbox_id;
    const previous = roots.get(key);
    if (
      !previous ||
      new Date(b.provider_checked_at ?? 0) > new Date(previous.provider_checked_at ?? 0)
    )
      roots.set(key, b);
  }
  const allocated = boxes.reduce((sum, b) => sum + BigInt(b.allocated_bytes ?? 0), 0n);
  const boxUsed = boxes.reduce((sum, b) => sum + BigInt(b.used_bytes), 0n);
  const checked =
    known
      .map((b) => b.provider_checked_at)
      .filter((v): v is string => !!v)
      .sort((a, b) => new Date(a).getTime() - new Date(b).getTime())[0] ?? null;
  return {
    ...row,
    shared_bytes: (BigInt(row.used_bytes) - boxUsed).toString(),
    allocated_bytes: allocated.toString(),
    remaining_allocation_bytes:
      row.storage_limit_bytes === null
        ? null
        : (BigInt(row.storage_limit_bytes) - allocated).toString(),
    provider: {
      used_bytes: [...roots.values()]
        .reduce((s, b) => s + BigInt(b.provider_used_bytes!), 0n)
        .toString(),
      limit_bytes: [...roots.values()]
        .reduce((s, b) => s + BigInt(b.provider_limit_bytes!), 0n)
        .toString(),
      known: known.length,
      total: boxes.length,
      checked_at: checked,
    },
    mailboxes: boxes.map((b) => {
      const publicBox = { ...b };
      delete (publicBox as Partial<typeof b>).provider_identity;
      return publicBox;
    }),
  };
}

export async function registerStorageQuotas(app: FastifyInstance, r: Resources) {
  const tenantParam = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
  const resume = async (tenant: string) => {
    const boxes = await r.db
      .selectFrom('mailboxes')
      .select('id')
      .where('tenant_id', '=', tenant)
      .where('deleted_at', 'is', null)
      .where('status', '=', 'active')
      .execute();
    // Scheduler is also retained: an unavailable queue cannot lose the checkpoint.
    for (const b of boxes)
      await r.queues['mailbox-sync']
        .add('sync', { mailbox_id: b.id })
        .catch(() => app.log.warn('Retomada será feita pelo agendador de sincronização.'));
  };
  app.get('/api/tenant/storage', async (req) => {
    const c = requireTenantAdmin(req.ctx);
    return readTenantQuota(r, c.tenantId);
  });
  app.get('/api/mailboxes/:id/storage', async (req) => {
    const c = requireTenant(req.ctx),
      id = tenantParam(req.params);
    await requireMailboxPerm(c, r.db, id, 'read');
    const b = (await readMailboxQuotas(r, c.tenantId, id))[0];
    if (!b) throw notFound();
    const publicBox = { ...b };
    delete (publicBox as Partial<typeof b>).provider_identity;
    return publicBox;
  });
  app.get('/api/superadmin/tenants/:id/storage', async (req) => {
    requireSuperAdmin(req.ctx);
    return readTenantQuota(r, tenantParam(req.params));
  });
  app.put('/api/superadmin/tenants/:id/storage-limits', async (req) => {
    const c = requireSuperAdmin(req.ctx),
      tenant = tenantParam(req.params),
      b = tenantQuotaSchema.parse(req.body);
    await r.db.transaction().execute(async (tx) => {
      const found = await tx
        .selectFrom('tenants')
        .select('id')
        .where('id', '=', tenant)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!found) throw notFound();
      await lockStorageTenant(tx, tenant);
      if (b.storage_limit_bytes !== null) {
        const pending = await tx
          .selectFrom('storage_assets')
          .select('id')
          .where('tenant_id', '=', tenant)
          .where((eb) =>
            eb.or([
              eb('state', '=', 'pending'),
              eb.and([eb('state', '=', 'unreadable'), eb('present_bytes', 'is', null)]),
            ]),
          )
          .executeTakeFirst();
        if (pending)
          throw conflict(
            'A conferência dos arquivos desta empresa ainda está pendente. Execute a reconciliação no painel de armazenamento antes de definir a cota.',
          );
      }
      const current = (
        await sql<{
          allocation_mode: string;
        }>`select allocation_mode from tenant_storage_limits where tenant_id=${tenant}::uuid`.execute(
          tx,
        )
      ).rows[0];
      if (current?.allocation_mode === 'manual' && b.storage_limit_bytes !== null) {
        const allocated = (
          await sql<{
            bytes: string;
          }>`select coalesce(sum(l.allocated_bytes),0)::text as bytes from mailbox_storage_limits l join mailboxes m on m.id=l.mailbox_id where m.tenant_id=${tenant}::uuid and m.deleted_at is null`.execute(
            tx,
          )
        ).rows[0]!.bytes;
        if (BigInt(allocated) > BigInt(b.storage_limit_bytes))
          throw conflict(
            'A distribuição manual ultrapassa o novo limite. Redistribua as caixas antes de reduzir a cota da empresa.',
          );
      }
      await sql`insert into tenant_storage_limits(tenant_id,max_mailboxes,storage_limit_bytes) values(${tenant}::uuid,${b.max_mailboxes},${b.storage_limit_bytes}::bigint)
       on conflict(tenant_id) do update set max_mailboxes=excluded.max_mailboxes,storage_limit_bytes=excluded.storage_limit_bytes,revision=tenant_storage_limits.revision+1`.execute(
        tx,
      );
      await sql`select storage_quota_rebalance(${tenant}::uuid)`.execute(tx);
      await sql`update mailbox_storage_limits set allocated_bytes=null where tenant_id=${tenant}::uuid and ${b.storage_limit_bytes}::bigint is null`.execute(
        tx,
      );
      // Unlimited capacity uses automatic allocation; a later finite cap must not silently allocate zero.
      if (b.storage_limit_bytes === null)
        await sql`update tenant_storage_limits set allocation_mode='equal' where tenant_id=${tenant}::uuid`.execute(
          tx,
        );
      await tx
        .insertInto('platform_audit')
        .values({
          actor_id: c.userId,
          action: 'tenant.storage_limits.updated',
          tenant_id: tenant,
          metadata: asJson(b),
        })
        .execute();
    });
    await resume(tenant);
    return readTenantQuota(r, tenant);
  });
  app.put('/api/tenant/storage-allocation', async (req) => {
    const c = requireTenantAdmin(req.ctx),
      b = allocationSchema.parse(req.body);
    await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      await sql`insert into tenant_storage_limits(tenant_id) values(${c.tenantId}::uuid) on conflict do nothing`.execute(
        tx,
      );
      const limits = (
        await sql<{
          cap: string | null;
        }>`select storage_limit_bytes::text as cap from tenant_storage_limits where tenant_id=${c.tenantId}::uuid`.execute(
          tx,
        )
      ).rows[0]!;
      const boxes = await tx
        .selectFrom('mailboxes')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where('deleted_at', 'is', null)
        .execute();
      if (b.mode === 'manual') {
        if (limits.cap === null)
          throw conflict(
            'O superadmin deve definir uma cota de armazenamento antes da distribuição manual.',
          );
        const ids = new Set(b.allocations.map((a) => a.mailbox_id));
        if (
          ids.size !== b.allocations.length ||
          ids.size !== boxes.length ||
          boxes.some((box) => !ids.has(box.id))
        )
          throw conflict(
            'Informe a distribuição de todas as caixas atuais da empresa. Atualize a página se uma caixa foi criada ou removida.',
          );
        const sum = b.allocations.reduce((s, a) => s + BigInt(a.bytes), 0n);
        if (sum > BigInt(limits.cap))
          throw conflict('A soma das cotas ultrapassa o limite de armazenamento da empresa.');
        for (const a of b.allocations)
          await sql`update mailbox_storage_limits set allocated_bytes=${a.bytes}::bigint where mailbox_id=${a.mailbox_id}::uuid and tenant_id=${c.tenantId}::uuid`.execute(
            tx,
          );
      }
      await sql`update tenant_storage_limits set allocation_mode=${b.mode},revision=revision+1 where tenant_id=${c.tenantId}::uuid`.execute(
        tx,
      );
      await sql`select storage_quota_rebalance(${c.tenantId}::uuid)`.execute(tx);
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'tenant.storage_allocation.updated',
        entityType: 'tenant',
        entityId: c.tenantId,
        metadata: b,
      });
    });
    await resume(c.tenantId);
    return readTenantQuota(r, c.tenantId);
  });
}
