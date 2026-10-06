import { sql, type Kysely } from 'kysely';
import type { BigIntStats } from 'node:fs';
import type { DB } from './types.js';

type Owner = {
  scope: 'mailbox' | 'tenant' | 'platform' | 'unassigned';
  tenant: string | null;
  box: string | null;
  category: string;
};
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export async function inferStorageOwner(db: Kysely<DB>, key: string): Promise<Owner> {
  const parts = key.split('/');
  if (parts[0] === 'avatars')
    return { scope: 'platform', tenant: null, box: null, category: 'avatar' };
  if (parts[0] === 'attachments' && uuid.test(parts[1] ?? '') && uuid.test(parts[2] ?? '')) {
    const found = await db
      .selectFrom('mailboxes')
      .select('id')
      .where('id', '=', parts[2]!)
      .where('tenant_id', '=', parts[1]!)
      .executeTakeFirst();
    if (found)
      return {
        scope: 'mailbox',
        tenant: parts[1]!,
        box: parts[2]!,
        category: key.endsWith('.tmp') ? 'temporary' : 'attachment',
      };
  }
  if (['uploads', 'signatures'].includes(parts[0] ?? '') && uuid.test(parts[1] ?? '')) {
    if (parts[0] === 'uploads' && parts.length >= 5 && uuid.test(parts[2] ?? '')) {
      const box = await db
        .selectFrom('mailboxes')
        .select('id')
        .where('id', '=', parts[2]!)
        .where('tenant_id', '=', parts[1]!)
        .executeTakeFirst();
      if (box) return { scope: 'mailbox', tenant: parts[1]!, box: box.id, category: 'upload' };
    }
    if (await db.selectFrom('tenants').select('id').where('id', '=', parts[1]!).executeTakeFirst())
      return {
        scope: 'tenant',
        tenant: parts[1]!,
        box: null,
        category: key.endsWith('.tmp')
          ? 'temporary'
          : parts[0] === 'uploads'
            ? 'upload'
            : 'signature_image',
      };
  }
  return {
    scope: 'unassigned',
    tenant: null,
    box: null,
    category: key.endsWith('.tmp') ? 'temporary' : 'unreferenced',
  };
}
export async function beginStorageOperation(
  db: Kysely<DB>,
  key: string,
  operation: 'write' | 'copy' | 'delete',
) {
  const owner = await inferStorageOwner(db, key);
  await sql`insert into storage_assets(storage_key,scope,tenant_id,mailbox_id,category)
    values(${key},${owner.scope},${owner.tenant}::uuid,${owner.box}::uuid,${owner.category})
    on conflict(storage_key) do update set updated_at=now(),revision=storage_assets.revision+1`.execute(
    db,
  );
  return (
    await sql<{
      id: string;
    }>`insert into storage_operations(storage_key,operation) values(${key},${operation}) returning id`.execute(
      db,
    )
  ).rows[0]!.id;
}
export async function observeStorageFile(
  db: Kysely<DB>,
  key: string,
  stats: BigIntStats | null,
  operationId?: string,
  scanId?: string,
  revision?: string,
) {
  const owner = await inferStorageOwner(db, key);
  const allocated =
    stats && process.platform === 'linux' && typeof stats.blocks === 'bigint'
      ? (stats.blocks * 512n).toString()
      : null;
  await sql`insert into storage_assets(storage_key,scope,tenant_id,mailbox_id,category,present_bytes,allocated_bytes,physical_key,state,observed_at,last_scan_id)
    values(${key},${owner.scope},${owner.tenant}::uuid,${owner.box}::uuid,${owner.category},${stats?.size.toString() ?? null}::bigint,
    ${allocated}::bigint,${stats ? String(stats.dev) + ':' + String(stats.ino) : null},${stats ? 'present' : operationId ? 'deleted' : 'missing'},now(),${scanId ?? null}::uuid)
    on conflict(storage_key) do update set present_bytes=excluded.present_bytes,allocated_bytes=excluded.allocated_bytes,
    physical_key=excluded.physical_key,state=excluded.state,observed_at=now(),last_scan_id=coalesce(excluded.last_scan_id,storage_assets.last_scan_id),
    updated_at=now(),revision=storage_assets.revision+1
    where ${revision ?? null}::bigint is null or storage_assets.revision=${revision ?? null}::bigint`.execute(
    db,
  );
  if (operationId)
    await sql`update storage_operations set state='done',finished_at=now() where id=${operationId}::uuid`.execute(
      db,
    );
}
export async function failStorageOperation(db: Kysely<DB>, operationId: string) {
  await sql`update storage_operations set state='failed',finished_at=now() where id=${operationId}::uuid`.execute(
    db,
  );
}

/** Reference changes commit with their domain row. Resolve shared ownership without multiplying files. */
export async function refreshStorageOwnership(db: Kysely<DB>) {
  await sql`update storage_asset_refs r set mailbox_id=(
      select case when count(distinct o.mailbox_id)=1 then min(o.mailbox_id::text)::uuid else (select u.mailbox_id from uploads u where u.id=r.source_id) end
      from outbox o where o.tenant_id=r.tenant_id and o.status in ('draft','queued','scheduled','sending','failed')
      and o.attachments @> jsonb_build_array(jsonb_build_object('source','upload','upload_id',r.source_id)))
    where r.source_kind='uploads'`.execute(db);
  await sql`with owners as (
    select asset_id,count(distinct tenant_id) as tenants,count(distinct mailbox_id) as boxes,
    bool_or(tenant_id is null) as has_platform,bool_or(mailbox_id is null) as shared,
    min(tenant_id::text)::uuid as tenant,min(mailbox_id::text)::uuid as box from storage_asset_refs group by asset_id
  ), desired as (select asset_id,case when o.tenants>1 or (o.has_platform and o.tenants>0) then 'unassigned'
      when o.has_platform then 'platform' when o.boxes=1 and not o.shared then 'mailbox' else 'tenant' end as scope,
    case when o.tenants=1 and not o.has_platform then o.tenant else null end as tenant,
    case when o.tenants=1 and not o.has_platform and o.boxes=1 and not o.shared then o.box else null end as box
    from owners o)
    update storage_assets s set scope=d.scope,tenant_id=d.tenant,mailbox_id=d.box from desired d
    where s.id=d.asset_id and (s.scope,s.tenant_id,s.mailbox_id) is distinct from (d.scope,d.tenant,d.box)`.execute(
    db,
  );
}
