import { randomUUID } from 'node:crypto';
import { simpleParser, type AddressObject } from 'mailparser';
import type { FetchMessageObject } from 'imapflow';
import {
  resolveThread,
  touchThreads,
  asJson,
  sanitizeEmailHtml,
  htmlToText,
  messageSnippet,
  type DB,
} from '@apmail/db';
import { isAutomated, type Address } from '@apmail/shared';
import type { Selectable } from 'kysely';
import type { WorkerResources } from '../resources.js';
import type { Mailbox } from './connect.js';
function addresses(value: AddressObject | AddressObject[] | undefined): Address[] {
  return (Array.isArray(value) ? value : [value]).flatMap((v) =>
    (v?.value ?? []).flatMap((a) =>
      a.address ? [{ name: a.name ?? '', address: a.address.toLowerCase() }] : [],
    ),
  );
}
export async function ingestMessage(
  r: WorkerResources,
  box: Mailbox,
  folder: Selectable<DB['folders']>,
  msg: FetchMessageObject,
): Promise<string> {
  const duplicate = await r.db
    .selectFrom('messages')
    .select('thread_id')
    .where('folder_id', '=', folder.id)
    .where('imap_uid', '=', String(msg.uid))
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (duplicate) return duplicate.thread_id;
  const parsed = msg.source
    ? await simpleParser(msg.source, { keepCidLinks: true, skipHtmlToText: true })
    : null;
  const env = msg.envelope;
  const from = addresses(parsed?.from)[0] ?? {
    name: env?.from?.[0]?.name ?? '',
    address: (env?.from?.[0]?.address ?? '').toLowerCase(),
  };
  const header = parsed?.messageId ?? env?.messageId ?? `<apmail-${randomUUID()}@apmail.local>`;
  const sentCopy = await r.db
    .selectFrom('messages')
    .select(['id', 'thread_id'])
    .where('tenant_id', '=', box.tenant_id)
    .where('mailbox_id', '=', box.id)
    .where('message_id_header', '=', header)
    .where('imap_uid', 'is', null)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (sentCopy) {
    await r.db
      .updateTable('messages')
      .set({ folder_id: folder.id, imap_uid: msg.uid, size_bytes: msg.size ?? 0 })
      .where('id', '=', sentCopy.id)
      .execute();
    return sentCopy.thread_id;
  }
  const text = parsed
    ? (parsed.text ?? htmlToText(parsed.html || ''))
    : '(Mensagem muito grande para ser exibida no APMail. Abra no provedor de e-mail.)';
  const own = [box.email_address, ...box.aliases].map((a) => a.toLowerCase());
  const date = parsed?.date ?? env?.date ?? msg.internalDate;
  const message_at = date instanceof Date && !isNaN(date.getTime()) ? date : new Date();
  const metadata = {
    tenant_id: box.tenant_id,
    mailbox_id: box.id,
    subject: parsed?.subject ?? env?.subject ?? '',
    message_at,
    in_reply_to: parsed?.inReplyTo ?? env?.inReplyTo ?? null,
    references_headers: (Array.isArray(parsed?.references)
      ? parsed.references
      : parsed?.references
        ? [parsed.references]
        : []
    ).slice(-50),
    from_address: from.address,
    to_addresses: addresses(parsed?.to).length
      ? addresses(parsed?.to)
      : (env?.to ?? []).map((a) => ({
          name: a.name ?? '',
          address: (a.address ?? '').toLowerCase(),
        })),
    cc_addresses: addresses(parsed?.cc),
  };
  const id = randomUUID(),
    written: string[] = [];
  try {
    return await r.db.transaction().execute(async (trx) => {
      const threadId = await resolveThread(trx, metadata, own);
      await trx
        .insertInto('messages')
        .values({
          ...metadata,
          to_addresses: asJson(metadata.to_addresses),
          cc_addresses: asJson(metadata.cc_addresses),
          id,
          folder_id: folder.id,
          thread_id: threadId,
          imap_uid: msg.uid,
          message_id_header: header,
          from_name: from.name,
          bcc_addresses: asJson(addresses(parsed?.bcc)),
          reply_to_addresses: asJson(addresses(parsed?.replyTo)),
          direction: own.includes(from.address) ? 'outbound' : 'inbound',
          is_automated: isAutomated(
            from.address,
            Object.fromEntries([...(parsed?.headers ?? [])].map(([k, v]) => [k, String(v)])),
          ),
          body_text: text,
          body_html: sanitizeEmailHtml(parsed?.html || '', text),
          snippet: messageSnippet(text),
          has_attachments: !!parsed?.attachments.some(
            (a) => a.contentDisposition !== 'inline' || !a.cid,
          ),
          size_bytes: msg.size ?? 0,
          is_flagged: msg.flags?.has('\\Flagged') ?? false,
        })
        .execute();
      for (const a of parsed?.attachments ?? []) {
        const attachmentId = randomUUID(),
          path = `attachments/${box.tenant_id}/${box.id}/${id}/${attachmentId}`;
        await r.storage.writeFile(path, a.content);
        written.push(path);
        await trx
          .insertInto('attachments')
          .values({
            id: attachmentId,
            tenant_id: box.tenant_id,
            mailbox_id: box.id,
            message_id: id,
            filename: a.filename ?? 'anexo',
            content_type: a.contentType,
            size_bytes: a.size,
            content_id: a.cid ?? null,
            is_inline: a.contentDisposition === 'inline' && !!a.cid,
            storage_path: path,
          })
          .execute();
      }
      await touchThreads(trx, [threadId], 'inbound', null);
      return threadId;
    });
  } catch (error) {
    await Promise.all(written.map((path) => r.storage.removeFile(path)));
    throw error;
  }
}
