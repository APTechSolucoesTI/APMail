import { sql, type Kysely } from 'kysely';
import type { DB } from '@apmail/db';
import { requireTenant, notFound, type RequestContext } from './context.js';
import { requireMailboxPerm } from './guards.js';
type Scope = string[] | null;
const cached = new WeakMap<RequestContext, Map<string, Promise<Scope>>>();
/** null = acesso integral; [] = nenhuma pasta. Cache somente durante esta requisição. */
export async function readableFolders(
  ctx: RequestContext,
  db: Kysely<DB>,
  boxId: string,
): Promise<Scope> {
  const c = requireTenant(ctx),
    role = await requireMailboxPerm(c, db, boxId, 'read');
  if (role === 'mailbox_admin') return null;
  let boxes = cached.get(c);
  if (!boxes) {
    boxes = new Map();
    cached.set(c, boxes);
  }
  if (!boxes.has(boxId))
    boxes.set(
      boxId,
      (async () => {
        const member = await db
          .selectFrom('mailbox_members')
          .select('restrict_to_folders')
          .where('tenant_id', '=', c.tenantId)
          .where('mailbox_id', '=', boxId)
          .where('user_id', '=', c.userId)
          .executeTakeFirst();
        if (!member) throw notFound();
        if (!member.restrict_to_folders) return null;
        const result = await sql<{ id: string }>`with recursive allowed as (
   select f.id from folders f join folder_permissions p on p.folder_id=f.id and p.tenant_id=f.tenant_id and p.mailbox_id=f.mailbox_id
   where p.tenant_id=${c.tenantId} and p.mailbox_id=${boxId} and p.user_id=${c.userId} and f.deleted_at is null
   union select f.id from folders f join allowed a on f.parent_id=a.id where f.tenant_id=${c.tenantId} and f.mailbox_id=${boxId} and f.deleted_at is null
  ) select id from allowed`.execute(db);
        return result.rows.map((row) => row.id);
      })(),
    );
  return boxes.get(boxId)!;
}
export const folderPredicate = (scope: Scope, column = 'm.folder_id') =>
  scope === null
    ? sql<boolean>`true`
    : scope.length
      ? sql<boolean>`${sql.ref(column)} in (${sql.join(scope.map((id) => sql`${id}::uuid`))})`
      : sql<boolean>`false`;
export async function requireFolder(
  ctx: RequestContext,
  db: Kysely<DB>,
  boxId: string,
  folderId: string | null,
) {
  const scope = await readableFolders(ctx, db, boxId);
  if (scope !== null && (!folderId || !scope.includes(folderId))) throw notFound();
}
