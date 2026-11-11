import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  activeInvitationPredicate,
  operatorThreadPredicate,
  serializeIntegrationMessages,
  Storage,
  assertFilesClean,
} from '@apmail/db';
import { ApiError, notFound } from '../authz/context.js';
import type { Resources } from './resources.js';
import { integrationApiAccess } from './integration-api-access.js';
import { integrationUser } from './integration-user.js';

const querySchema = z.object({
  email: z.email().max(254),
  messageId: z.uuid().optional(),
  mailboxId: z.uuid().optional(),
  cursor: z.string().max(2000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const cursorSchema = z.object({
  v: z.literal(1),
  tenant: z.uuid(),
  user: z.uuid(),
  token: z.uuid(),
  mailbox: z.uuid().nullable(),
  after: z
    .string()
    .regex(/^\d{1,19}$/)
    .refine((value) => BigInt(value) <= 9223372036854775807n),
});

function visibleMessages(tenantId: string, userId: string, tokenId: string) {
  return sql`with recursive boxes as (
    select b.id,(mm.role in ('mailbox_admin','supervisor') or not mm.restrict_to_folders) full_access
    from mailboxes b join mailbox_members mm on mm.mailbox_id=b.id and mm.tenant_id=b.tenant_id
    where b.tenant_id=${tenantId} and b.deleted_at is null and mm.user_id=${userId}
  ), allowed_folders as (
    select f.id,f.mailbox_id from folders f join boxes b on b.id=f.mailbox_id where f.tenant_id=${tenantId} and f.deleted_at is null
      and (b.full_access or exists(select 1 from folder_permissions p where p.tenant_id=f.tenant_id and p.mailbox_id=f.mailbox_id and p.folder_id=f.id and p.user_id=${userId}))
    union select f.id,f.mailbox_id from folders f join allowed_folders a on a.id=f.parent_id and a.mailbox_id=f.mailbox_id where f.tenant_id=${tenantId} and f.deleted_at is null
  ), visible as (
    select m.id,e.sequence from messages m join threads t on t.id=m.thread_id and t.tenant_id=m.tenant_id
    join mailboxes b on b.id=m.mailbox_id and b.tenant_id=m.tenant_id and b.deleted_at is null
    join folders f on f.id=m.folder_id and f.mailbox_id=m.mailbox_id and f.tenant_id=m.tenant_id and f.deleted_at is null
    join integration_api_token_mailboxes grant_box on grant_box.tenant_id=m.tenant_id and grant_box.mailbox_id=m.mailbox_id and grant_box.token_id=${tokenId}
    left join integration_message_events e on e.message_id=m.id and e.tenant_id=m.tenant_id
    where m.tenant_id=${tenantId} and m.deleted_at is null and t.deleted_at is null
    and (${activeInvitationPredicate(tenantId, userId, sql`m.thread_id`)} or (
      (exists(select 1 from boxes full_box where full_box.id=m.mailbox_id and full_box.full_access)
       or exists(select 1 from allowed_folders af where af.id=m.folder_id and af.mailbox_id=m.mailbox_id))
      and ${operatorThreadPredicate(tenantId, userId, sql`m.thread_id`, sql`m.mailbox_id`, false)}))
  )`;
}

export function registerIntegrationMessages(app: FastifyInstance, r: Resources) {
  const access = integrationApiAccess(app, r);
  const rateLimit = {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req: import('fastify').FastifyRequest) =>
      'integration-content:' + access.scope(req).id,
  };
  app.get(
    '/api/integrations/messages',
    { onRequest: access.requirePermission('messages:read'), config: { rateLimit } },
    async (req) => {
      const q = querySchema.parse(req.query),
        scope = access.scope(req),
        user = await integrationUser(r.db, scope, q.email);
      let cursor: z.infer<typeof cursorSchema> | undefined;
      if (q.cursor) {
        try {
          cursor = cursorSchema.parse(
            JSON.parse(Buffer.from(q.cursor, 'base64url').toString('utf8')),
          );
        } catch {
          throw new ApiError(400, 'invalid_cursor', 'Cursor de consulta inválido.');
        }
        if (
          cursor.tenant !== scope.tenantId ||
          cursor.user !== user.id ||
          cursor.token !== scope.id ||
          cursor.mailbox !== (q.mailboxId ?? null)
        )
          throw new ApiError(400, 'invalid_cursor', 'Cursor de consulta inválido.');
      }
      return r.db
        .transaction()
        .setIsolationLevel('repeatable read')
        .execute(async (tx) => {
          const visibility = visibleMessages(scope.tenantId, user.id, scope.id);
          if (q.messageId) {
            const permitted = await sql<{
              id: string;
            }>`${visibility} select id from visible where id=${q.messageId}::uuid`.execute(tx);
            if (!permitted.rows.length) throw notFound();
            const message = (
              await serializeIntegrationMessages(tx, scope.tenantId, [q.messageId], {
                userId: user.id,
              })
            )[0];
            if (!message) throw notFound();
            return { success: true, data: message };
          }
          const watermark =
            (
              await tx
                .selectFrom('integration_event_counters')
                .select('last_sequence')
                .where('tenant_id', '=', scope.tenantId)
                .executeTakeFirst()
            )?.last_sequence ?? '0';
          if (BigInt(cursor?.after ?? '0') > BigInt(watermark))
            throw new ApiError(400, 'invalid_cursor', 'Cursor de consulta inválido.');
          const rows = (
            await sql<{
              id: string;
              sequence: string;
            }>`${visibility} select v.id,v.sequence::text sequence from visible v
        join messages m on m.id=v.id where v.sequence>${cursor?.after ?? '0'}::bigint and v.sequence<=${watermark}::bigint
        ${q.mailboxId ? sql`and m.mailbox_id=${q.mailboxId}::uuid` : sql``}
        order by v.sequence limit ${q.limit + 1}`.execute(tx)
          ).rows;
          const hasMore = rows.length > q.limit,
            selected = rows.slice(0, q.limit);
          const nextCursor = Buffer.from(
            JSON.stringify({
              v: 1,
              tenant: scope.tenantId,
              user: user.id,
              token: scope.id,
              mailbox: q.mailboxId ?? null,
              after: hasMore ? selected.at(-1)!.sequence : watermark,
            }),
          ).toString('base64url');
          const items = await serializeIntegrationMessages(
            tx,
            scope.tenantId,
            selected.map((row) => row.id),
            { userId: user.id, includeBody: false },
          );
          return { success: true, data: { items, nextCursor, hasMore } };
        });
    },
  );
  app.get(
    '/api/integrations/messages/:messageId/attachments/:attachmentId',
    { onRequest: access.requirePermission('attachments:download'), config: { rateLimit } },
    async (req, reply) => {
      const { messageId, attachmentId } = z
        .object({ messageId: z.uuid(), attachmentId: z.uuid() })
        .parse(req.params);
      const { email } = querySchema.pick({ email: true }).parse(req.query),
        scope = access.scope(req),
        user = await integrationUser(r.db, scope, email);
      const allowed = await sql<{
        id: string;
      }>`${visibleMessages(scope.tenantId, user.id, scope.id)} select id from visible where id=${messageId}::uuid`.execute(
        r.db,
      );
      if (!allowed.rows.length) throw notFound();
      const attachment = await r.db
        .selectFrom('attachments')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .where('message_id', '=', messageId)
        .where('id', '=', attachmentId)
        .executeTakeFirst();
      if (!attachment) throw notFound();
      const storage = new Storage(r.env.STORAGE_DIR, r.db);
      await assertFilesClean(r.db, [attachment.storage_path], storage);
      const filename = attachment.filename.replace(/[\r\n"\\]/g, '_');
      reply
        .header('Cache-Control', 'no-store')
        .header('X-Content-Type-Options', 'nosniff')
        .header('Content-Security-Policy', "default-src 'none'; sandbox")
        .header(
          'Content-Disposition',
          `attachment; filename="${filename.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g, (c) => '%' + c.charCodeAt(0).toString(16))}`,
        )
        .type(attachment.content_type);
      return reply.send(await storage.openReadStream(attachment.storage_path));
    },
  );
}
