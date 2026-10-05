import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import type { PlatformStorageResult } from '@apmail/shared';
import { requireSuperAdmin } from '../authz/context.js';
import type { Resources } from './resources.js';

const querySchema = z.object({
  scope: z.enum(['tenants', 'mailboxes']).default('tenants'),
  tenant_id: z.uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce
    .number()
    .int()
    .refine((n) => [10, 20, 30, 50, 100].includes(n))
    .default(10),
  search: z.string().trim().max(200).default(''),
  sort: z
    .enum([
      'name',
      'tenant_name',
      'messages',
      'content_bytes',
      'attachment_bytes',
      'shared_bytes',
      'total_bytes',
    ])
    .default('total_bytes'),
  direction: z.enum(['asc', 'desc']).default('desc'),
});

export async function registerPlatformStorage(app: FastifyInstance, r: Resources) {
  app.get('/api/superadmin/storage', async (req): Promise<PlatformStorageResult> => {
    requireSuperAdmin(req.ctx);
    const q = querySchema.parse(req.query);
    // A single snapshot keeps totals and pages consistent. Soft-deleted rows still consume space.
    // MIME source sizes already include attachments and are informational, never added to totals.
    const result = await sql<{
      items: PlatformStorageResult['items'];
      total: number;
      summary: PlatformStorageResult['summary'];
    }>`with selected_tenants as (
      select id, name, deleted_at from tenants ${q.tenant_id ? sql`where id=${q.tenant_id}::uuid` : sql``}
    ), content as (
      select m.tenant_id, m.mailbox_id, sum(octet_length(coalesce(m.body_html,''))::bigint + octet_length(m.body_text)) as bytes,
        count(*) as messages, sum(m.size_bytes::bigint) as source_bytes
      from messages m join selected_tenants t on t.id=m.tenant_id group by m.tenant_id,m.mailbox_id
    ), drafts as (
      select o.tenant_id,o.mailbox_id,sum(octet_length(o.body_html)::bigint) as bytes
      from outbox o join selected_tenants t on t.id=o.tenant_id group by o.tenant_id,o.mailbox_id
    ), file_refs as (
      select a.tenant_id,a.mailbox_id,a.storage_path,a.size_bytes,0 as priority from attachments a join selected_tenants t on t.id=a.tenant_id
      union all select u.tenant_id,null::uuid,u.storage_path,u.size_bytes,1 from uploads u join selected_tenants t on t.id=u.tenant_id where u.consumed_at is null
      union all select s.tenant_id,null::uuid,s.storage_path,s.size_bytes,2 from signature_images s join selected_tenants t on t.id=s.tenant_id
    ), unique_files as (
      select distinct on (storage_path) tenant_id,mailbox_id,storage_path,max(size_bytes) over (partition by storage_path) as bytes
      from file_refs order by storage_path,priority,tenant_id,mailbox_id
    ), attachments_usage as (
      select tenant_id,mailbox_id,sum(bytes::bigint) as bytes from unique_files where mailbox_id is not null group by tenant_id,mailbox_id
    ), shared_usage as (
      select tenant_id,sum(bytes) as bytes from (
        select tenant_id,sum(bytes::bigint) as bytes from unique_files where mailbox_id is null group by tenant_id
        union all select s.tenant_id,sum(octet_length(s.body_html)::bigint) from signatures s join selected_tenants t on t.id=s.tenant_id group by s.tenant_id
      ) s group by tenant_id
    ), boxes as (
      select b.id,b.tenant_id,t.name as tenant_name,b.name,b.email_address,(b.deleted_at is not null or t.deleted_at is not null) as retained_deleted,
        (coalesce(c.bytes,0)+coalesce(d.bytes,0))::float8 as content_bytes,
        coalesce(a.bytes,0)::float8 as attachment_bytes,0::float8 as shared_bytes,
        (coalesce(c.bytes,0)+coalesce(d.bytes,0)+coalesce(a.bytes,0))::float8 as total_bytes,
        coalesce(c.messages,0)::float8 as messages,coalesce(c.source_bytes,0)::float8 as source_mail_bytes
      from mailboxes b join selected_tenants t on t.id=b.tenant_id
      left join content c on c.mailbox_id=b.id and c.tenant_id=b.tenant_id
      left join drafts d on d.mailbox_id=b.id and d.tenant_id=b.tenant_id
      left join attachments_usage a on a.mailbox_id=b.id and a.tenant_id=b.tenant_id
    ), companies as (
      select t.id,t.id as tenant_id,t.name as tenant_name,t.name,null::text as email_address,(t.deleted_at is not null) as retained_deleted,
        coalesce(sum(b.content_bytes),0)::float8 as content_bytes,coalesce(sum(b.attachment_bytes),0)::float8 as attachment_bytes,
        coalesce(s.bytes,0)::float8 as shared_bytes,
        (coalesce(sum(b.total_bytes),0)+coalesce(s.bytes,0))::float8 as total_bytes,
        coalesce(sum(b.messages),0)::float8 as messages,coalesce(sum(b.source_mail_bytes),0)::float8 as source_mail_bytes
      from selected_tenants t left join boxes b on b.tenant_id=t.id left join shared_usage s on s.tenant_id=t.id group by t.id,t.name,t.deleted_at,s.bytes
    ), filtered as (
      select * from ${q.scope === 'tenants' ? sql`companies` : sql`boxes`}
      where unaccent(name) ilike unaccent(${'%' + q.search + '%'}) or unaccent(tenant_name) ilike unaccent(${'%' + q.search + '%'}) or unaccent(email_address) ilike unaccent(${'%' + q.search + '%'})
    ), paged as (
      select * from filtered order by ${sql.ref(q.sort)} ${q.direction === 'asc' ? sql`asc` : sql`desc`},id
      limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}
    ) select coalesce((select jsonb_agg(p) from paged p),'[]'::jsonb) as items,
      (select count(*)::float8 from filtered) as total,
      (select jsonb_build_object('content_bytes',coalesce(sum(content_bytes),0), 'attachment_bytes',coalesce(sum(attachment_bytes),0),
        'shared_bytes',coalesce(sum(shared_bytes),0),'total_bytes',coalesce(sum(total_bytes),0),'messages',coalesce(sum(messages),0),
        'source_mail_bytes',coalesce(sum(source_mail_bytes),0)) from filtered) as summary`.execute(
      r.db,
    );
    return {
      ...result.rows[0]!,
      page: q.page,
      pageSize: q.pageSize,
      measured_at: new Date().toISOString(),
    };
  });
}
