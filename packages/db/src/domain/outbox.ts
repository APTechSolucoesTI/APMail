import type { Selectable } from 'kysely';
import { outboxAttachmentSchema, type OutboxAttachment } from '@apmail/shared';
import type { Database } from './threads.js';
import type { Outbox } from '../types.js';
export type OutboxRow = Selectable<Outbox>;
export async function resolveOutboxAttachments(
  db: Database,
  row: Pick<OutboxRow, 'attachments' | 'tenant_id' | 'mailbox_id' | 'created_by'>,
) {
  const refs = (row.attachments as OutboxAttachment[]).map((ref) =>
    outboxAttachmentSchema.parse(ref),
  );
  const keys = new Set<string>();
  const files: {
    id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    storage_path: string;
    is_inline: boolean;
    content_id: string | null;
    upload_id: string | null;
  }[] = [];
  for (const ref of refs) {
    const key = ref.source === 'upload' ? ref.upload_id : ref.attachment_id;
    if (keys.has(key)) throw new Error('Um anexo foi incluído mais de uma vez.');
    keys.add(key);
    if (ref.source === 'upload') {
      const file = await db
        .selectFrom('uploads')
        .selectAll()
        .where('id', '=', ref.upload_id)
        .where('tenant_id', '=', row.tenant_id)
        .where('user_id', '=', row.created_by)
        .where('consumed_at', 'is', null)
        .executeTakeFirst();
      if (!file) throw new Error('Um dos anexos não está disponível.');
      files.push({ ...file, is_inline: false, content_id: null, upload_id: file.id });
    } else {
      const file = await db
        .selectFrom('attachments')
        .innerJoin('messages', 'messages.id', 'attachments.message_id')
        .selectAll('attachments')
        .where('attachments.id', '=', ref.attachment_id)
        .where('attachments.tenant_id', '=', row.tenant_id)
        .where('attachments.mailbox_id', '=', row.mailbox_id)
        .where('messages.deleted_at', 'is', null)
        .executeTakeFirst();
      if (!file) throw new Error('Um dos anexos não pertence a esta caixa.');
      files.push({ ...file, upload_id: null });
    }
  }
  return files;
}
// BullMQ não aceita dois-pontos no jobId. A identidade conserva os três componentes.
export const outboxJobId = (id: string, count: number) => `outbox~${id}~${count}`;
export const sendJobOptions = (row: Pick<OutboxRow, 'job_id' | 'send_after'>) => ({
  jobId: row.job_id!,
  delay: Math.max(0, (row.send_after?.getTime() ?? 0) - Date.now()),
  attempts: 3,
  backoff: { type: 'custom' },
});
