import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import { can, profileAllowsMailbox, type Address } from '@apmail/shared';
import { requireTenant } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import { readableFolders, folderPredicate } from '../authz/folders.js';
import type { Resources } from './resources.js';

type DraftItem = {
  id: string;
  source: 'draft' | 'message';
  thread_id: string | null;
  subject: string;
  to_addresses: Address[];
  snippet: string;
  updated_at: Date;
  has_attachments: boolean;
  can_edit: boolean;
};
/** Private composer drafts and readable provider drafts share one paginated folder. */
export async function registerMailboxDrafts(app: FastifyInstance, r: Resources) {
  app.get('/api/mailboxes/:id/drafts', async (req) => {
    const c = requireTenant(req.ctx);
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const q = z
      .object({
        q: z.string().max(200).optional(),
        page: z.coerce.number().int().min(1).default(1),
        page_size: z.coerce
          .number()
          .refine((n) => [10, 20, 25, 30, 50, 100].includes(n))
          .default(10),
      })
      .parse(req.query);
    const role = await requireMailboxPerm(c, r.db, id, 'read');
    const scope = await readableFolders(c, r.db, id);
    const editable =
      can(role, 'send') &&
      (!(c.accessRestricted ?? !!c.accessProfileId) ||
        profileAllowsMailbox(
          { role: c.tenantRole, access_permissions: c.accessPermissions },
          'send',
        ));
    const rows = sql`with drafts as (
      select o.id, 'draft'::text as source, o.thread_id, o.subject, o.to_addresses,
        left(regexp_replace(o.body_html, '<[^>]*>', ' ', 'g'), 200) as snippet,
        o.updated_at, jsonb_array_length(o.attachments) > 0 as has_attachments,
        ${editable}::boolean as can_edit
      from outbox o where o.tenant_id=${c.tenantId} and o.mailbox_id=${id}
        and o.created_by=${c.userId} and o.status='draft' and o.mdn_original_message_id is null
        and o.calendar_payload is null
      union all
      select m.id, 'message'::text, m.thread_id, m.subject, m.to_addresses,
        m.snippet, m.updated_at, m.has_attachments, false
      from messages m join folders f on f.id=m.folder_id and f.tenant_id=m.tenant_id
        and f.mailbox_id=m.mailbox_id
      join threads t on t.id=m.thread_id and t.tenant_id=m.tenant_id and t.mailbox_id=m.mailbox_id
      where m.tenant_id=${c.tenantId} and m.mailbox_id=${id} and m.deleted_at is null
        and f.deleted_at is null and t.deleted_at is null and f.special_use='drafts'
        and ${folderPredicate(scope)}
    ), filtered as (select * from drafts where ${
      q.q
        ? sql`(subject ilike ${'%' + q.q + '%'} or snippet ilike ${'%' + q.q + '%'} or to_addresses::text ilike ${'%' + q.q + '%'})`
        : sql`true`
    })`;
    const total = Number(
      (await sql<{ total: string }>`${rows} select count(*) as total from filtered`.execute(r.db))
        .rows[0]?.total ?? 0,
    );
    const result = await sql<DraftItem>`${rows} select * from filtered order by updated_at desc, id
      limit ${q.page_size} offset ${(q.page - 1) * q.page_size}`.execute(r.db);
    return { items: result.rows, total, page: q.page, pageSize: q.page_size };
  });
}
