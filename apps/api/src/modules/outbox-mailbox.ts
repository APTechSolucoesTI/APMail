import { sql } from 'kysely';
import {
  lockStorageTenant,
  assertStorageCapacity,
  type Database,
  type OutboxRow,
} from '@apmail/db';
import type { OutboxInput } from '@apmail/shared';
import { conflict, notFound, type RequestContext } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
export async function moveDraftUploads(
  db: Database,
  c: RequestContext,
  row: OutboxRow,
  body: OutboxInput,
) {
  if (row.mailbox_id === body.mailbox_id) return;
  if (
    row.kind !== 'new' ||
    body.kind !== 'new' ||
    row.thread_id ||
    body.thread_id ||
    row.reply_to_message_id ||
    body.reply_to_message_id
  )
    throw conflict('A caixa de uma resposta ou encaminhamento não pode ser alterada.');
  await requireMailboxPerm(c, db, row.mailbox_id, 'send');
  await requireMailboxPerm(c, db, body.mailbox_id, 'send');
  await lockStorageTenant(db, row.tenant_id);
  for (const ref of body.attachments) {
    if (ref.source !== 'upload')
      throw conflict('Anexos de outra conversa não podem ser transferidos.');
    const upload = await db
      .selectFrom('uploads')
      .selectAll()
      .where('id', '=', ref.upload_id)
      .where('tenant_id', '=', row.tenant_id)
      .where('user_id', '=', c.userId)
      .where('consumed_at', 'is', null)
      .forUpdate()
      .executeTakeFirst();
    if (!upload || (upload.mailbox_id && upload.mailbox_id !== row.mailbox_id)) throw notFound();
    const shared = await db
      .selectFrom('outbox')
      .select('id')
      .where('tenant_id', '=', row.tenant_id)
      .where('id', '!=', row.id)
      .where(
        sql<boolean>`attachments @> jsonb_build_array(jsonb_build_object('source','upload','upload_id',${upload.id}::uuid))`,
      )
      .executeTakeFirst();
    if (shared)
      throw conflict(
        'Um anexo está em outro rascunho. Remova o vínculo antes de trocar o remetente.',
      );
    const otherRefs =
      await sql`select 1 from storage_asset_refs mine join storage_asset_refs other on other.asset_id=mine.asset_id where mine.source_kind='uploads' and mine.source_id=${upload.id}::uuid and (other.source_kind,other.source_id)<>(mine.source_kind,mine.source_id) limit 1`.execute(
        db,
      );
    if (otherRefs.rows.length)
      throw conflict('Um arquivo compartilhado não pode ser transferido para outra caixa.');
    await db
      .updateTable('uploads')
      .set({ mailbox_id: body.mailbox_id })
      .where('id', '=', upload.id)
      .where('tenant_id', '=', row.tenant_id)
      .execute();
    await db
      .updateTable('storage_asset_refs')
      .set({ mailbox_id: body.mailbox_id })
      .where('source_kind', '=', 'uploads')
      .where('source_id', '=', upload.id)
      .where('tenant_id', '=', row.tenant_id)
      .execute();
    await sql`update storage_assets a set scope='mailbox',mailbox_id=${body.mailbox_id}::uuid,revision=revision+1,updated_at=now() where a.tenant_id=${row.tenant_id}::uuid and exists(select 1 from storage_asset_refs ref where ref.asset_id=a.id and ref.source_kind='uploads' and ref.source_id=${upload.id}::uuid)`.execute(
      db,
    );
  }
  await assertStorageCapacity(db, row.tenant_id, body.mailbox_id);
}
