import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { Storage } from './storage.js';
import type { DB } from './types.js';
import type { Selectable, Kysely } from 'kysely';
import type { Address } from '@apmail/shared';
import { assertFilesClean } from './security/files.js';
import { sanitizeEmailHtml } from './sanitize.js';
type Message = Selectable<DB['messages']>;
export function toMbox(raw: Buffer, date: Date, sender: string) {
  // mboxrd: quote every From separator, including already quoted body lines.
  const escaped = raw
    .toString('latin1')
    .replace(/^(>*From )/gm, '>$1')
    .replace(/\r?\n/g, '\n');
  const from = sender.replace(/[^a-zA-Z0-9@._+-]/g, '') || 'apmail@localhost';
  return Buffer.from(
    `From ${from} ${date.toUTCString()}\n${escaped.replace(/\n*$/, '')}\n\n`,
    'latin1',
  );
}
export async function backupMime(
  db: Kysely<DB>,
  storage: Storage,
  m: Message,
  options: { preferRaw?: boolean } = {},
) {
  const preferRaw = options.preferRaw !== false && !m.archive_reconstructed_key;
  const attachments = await db
    .selectFrom('attachments')
    .selectAll()
    .where('message_id', '=', m.id)
    .where('tenant_id', '=', m.tenant_id)
    .execute();
  await assertFilesClean(
    db,
    [
      ...attachments.map((attachment) => attachment.storage_path),
      ...(m.raw_storage_path && preferRaw ? [m.raw_storage_path] : []),
    ],
    storage,
  );
  if (m.raw_storage_path && preferRaw) return storage.openReadStream(m.raw_storage_path);
  const files = [];
  for (const a of attachments)
    files.push({
      filename: a.filename,
      contentType: a.content_type,
      cid: a.content_id ?? undefined,
      contentDisposition: a.is_inline ? ('inline' as const) : ('attachment' as const),
      content: await storage.openReadStream(a.storage_path),
    });
  return new MailComposer({
    from: { name: m.from_name, address: m.from_address || 'unknown@localhost' },
    to: m.to_addresses as unknown as Address[],
    cc: m.cc_addresses as unknown as Address[],
    bcc: m.bcc_addresses as unknown as Address[],
    replyTo: m.reply_to_addresses as unknown as Address[],
    subject: m.subject,
    date: m.message_at,
    messageId: m.message_id_header,
    inReplyTo: m.in_reply_to ?? undefined,
    references: m.references_headers,
    text: m.body_text,
    // Stored display HTML parks CID/remote URLs in data attributes. Restore the
    // references for MIME export only after all attached files passed the guard.
    html: m.body_html ? sanitizeEmailHtml(m.body_html, m.body_text, false) : undefined,
    attachments: files,
    headers: { 'X-APMail-Backup-Source': 'reconstructed', 'X-APMail-Message-ID': m.id },
  })
    .compile()
    .createReadStream();
}
