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
  assertStorageCapacity,
  lockStorageTenant,
} from '@apmail/db';
import { isAutomated, type Address } from '@apmail/shared';
import { sql, type Selectable, type Kysely } from 'kysely';
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
  external?: {
    kind: 'archive' | 'pop3';
    key: string;
    historical: boolean;
    measureStorage?: boolean;
    persisted?: (tx: Kysely<DB>, imported: boolean, addedStorageBytes?: bigint) => Promise<void>;
  },
): Promise<string> {
  const duplicate = await r.db
    .selectFrom('messages')
    .select('thread_id')
    .$if(!external, (q) =>
      q
        .where('folder_id', '=', folder.id)
        .where('imap_uid', '=', String(msg.uid))
        .where('deleted_at', 'is', null),
    )
    .$if(!!external, (q) =>
      q
        .where('mailbox_id', '=', box.id)
        .where('tenant_id', '=', box.tenant_id)
        .where('source_kind', '=', external!.kind)
        .where('source_key', '=', external!.key),
    )
    .executeTakeFirst();
  if (duplicate) {
    if (external?.persisted)
      await r.db.transaction().execute((tx) => external.persisted!(tx, false));
    return duplicate.thread_id;
  }
  const parsed = msg.source
    ? await simpleParser(msg.source, { keepCidLinks: true, skipHtmlToText: true })
    : null;
  const env = msg.envelope;
  const from = addresses(parsed?.from)[0] ?? {
    name: env?.from?.[0]?.name ?? '',
    address: (env?.from?.[0]?.address ?? '').toLowerCase(),
  };
  const header = parsed?.messageId ?? env?.messageId ?? `<apmail-${randomUUID()}@apmail.local>`;
  if (external?.kind === 'archive' && parsed?.messageId) {
    const existing = await r.db
      .selectFrom('messages')
      .select('thread_id')
      .where('tenant_id', '=', box.tenant_id)
      .where('mailbox_id', '=', box.id)
      .where('message_id_header', '=', parsed.messageId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (existing) {
      if (external.persisted)
        await r.db.transaction().execute((tx) => external.persisted!(tx, false));
      return existing.thread_id;
    }
  }
  const sentCopy = await r.db
    .selectFrom('messages')
    .select(['id', 'thread_id'])
    .where('tenant_id', '=', box.tenant_id)
    .where('mailbox_id', '=', box.id)
    .where('message_id_header', '=', header)
    .where('imap_uid', 'is', null)
    .where('source_kind', '=', 'imap')
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (sentCopy && !external) {
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
  const date = [parsed?.date, env?.date, msg.internalDate].find(
    (value) => value instanceof Date && !isNaN(value.getTime()),
  );
  const message_at = date instanceof Date ? date : new Date();
  const prior = await r.db
    .selectFrom('messages')
    .select('is_historical')
    .where('tenant_id', '=', box.tenant_id)
    .where('mailbox_id', '=', box.id)
    .where('message_id_header', '=', header)
    .executeTakeFirst();
  // INTERNALDATE survives moves; a folder first discovered later must not turn new mail into history.
  const internalDate =
    msg.internalDate instanceof Date && !isNaN(msg.internalDate.getTime())
      ? msg.internalDate
      : null;
  const isHistorical =
    external?.historical ??
    prior?.is_historical ??
    (!!box.import_started_at &&
      (internalDate
        ? internalDate <= box.import_started_at
        : folder.initial_uid_end !== null && msg.uid <= Number(folder.initial_uid_end)));
  const eligible =
    !isHistorical ||
    (!!box.import_started_at &&
      box.history_classify_days > 0 &&
      message_at.getTime() >=
        box.import_started_at.getTime() - box.history_classify_days * 86400000);
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
      await lockStorageTenant(trx, box.tenant_id);
      const liveBox = await trx
        .selectFrom('mailboxes')
        .select('id')
        .where('id', '=', box.id)
        .where('tenant_id', '=', box.tenant_id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!liveBox) throw new Error('A caixa foi excluída.');
      const usage = async () =>
        BigInt(
          (
            await sql<{
              bytes: string;
            }>`select storage_quota_usage(${box.tenant_id}::uuid,${box.id}::uuid)::text as bytes`.execute(
              trx,
            )
          ).rows[0]!.bytes,
        );
      const before = external?.measureStorage ? await usage() : 0n;
      const threadId = await resolveThread(trx, metadata, own);
      const hasMessage = await trx
        .selectFrom('messages')
        .select('id')
        .where('thread_id', '=', threadId)
        .executeTakeFirst();
      if (!hasMessage || eligible)
        await trx
          .updateTable('threads')
          .set({ history_queue_eligible: eligible })
          .where('id', '=', threadId)
          .execute();
      const rawPath =
        external && msg.source ? `mail-raw/${box.tenant_id}/${box.id}/${id}.eml` : null;
      if (rawPath && msg.source) {
        await r.storage.withDatabase(trx).writeFile(rawPath, msg.source);
        written.push(rawPath);
      }
      await trx
        .insertInto('messages')
        .values({
          ...metadata,
          to_addresses: asJson(metadata.to_addresses),
          cc_addresses: asJson(metadata.cc_addresses),
          id,
          source_kind: external?.kind ?? 'imap',
          source_key: external?.key ?? null,
          raw_storage_path: rawPath,
          is_historical: isHistorical,
          folder_id: folder.id,
          rules_inbox: folder.special_use === 'inbox',
          thread_id: threadId,
          imap_uid: external ? null : msg.uid,
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
        await r.storage.withDatabase(trx).writeFile(path, a.content);
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
      await touchThreads(
        trx,
        [threadId],
        own.includes(from.address) ? 'outbound' : 'inbound',
        null,
      );
      await assertStorageCapacity(trx, box.tenant_id, box.id);
      if (external?.persisted) {
        const growth = external.measureStorage ? (await usage()) - before : 0n;
        await external.persisted(trx, true, growth > 0n ? growth : 0n);
      }
      return threadId;
    });
  } catch (error) {
    await Promise.all(
      written.map((path) =>
        r.storage
          .removeFile(path)
          .catch(() =>
            r.log.warn({ mailbox_id: box.id }, 'Limpeza de anexo pendente de reconciliação.'),
          ),
      ),
    );
    throw error;
  }
}
