import { randomUUID } from 'node:crypto';
import type { ParsedMail, AddressObject } from 'mailparser';
import {
  messageIdSchema,
  mdnRequestSchema,
  parseMdnFields,
  protocolAddressEqual,
  type MdnRequest,
} from '@apmail/shared';
import type { Mailbox } from '../imap/connect.js';
import type { Database } from '@apmail/db';

function header(parsed: ParsedMail, key: string) {
  const lines = parsed.headerLines.filter((h) => h.key === key);
  if (lines.length !== 1) return null;
  return lines[0]!.line
    .slice(lines[0]!.line.indexOf(':') + 1)
    .replace(/\r?\n[ \t]+/g, ' ')
    .trim();
}
function headerAddresses(parsed: ParsedMail, key: string): string[] {
  if (!header(parsed, key)) return [];
  const value = parsed.headers.get(key) as AddressObject | undefined;
  return value?.value?.flatMap((a) => (a.address ? [a.address] : [])) ?? [];
}
function contentType(parsed: ParsedMail) {
  const value = parsed.headers.get('content-type') as
    { value?: string; params?: Record<string, string> } | undefined;
  return value;
}
export function isMdnReport(parsed: ParsedMail) {
  const type = contentType(parsed);
  return (
    type?.value?.toLowerCase() === 'multipart/report' &&
    type.params?.['report-type']?.toLowerCase() === 'disposition-notification'
  );
}
export function readMdnRequest(
  parsed: ParsedMail,
  box: Pick<Mailbox, 'email_address' | 'aliases'>,
): MdnRequest | null {
  if (
    ['auto-submitted', 'disposition-notification-options'].some(
      (key) => parsed.headerLines.filter((line) => line.key === key).length > 1,
    )
  )
    return null;
  const type = contentType(parsed)?.value?.toLowerCase();
  if (
    isMdnReport(parsed) ||
    type === 'multipart/report' ||
    type === 'message/partial' ||
    type === 'message/disposition-notification' ||
    header(parsed, 'list-id') ||
    header(parsed, 'newsgroups')
  )
    return null;
  const auto = header(parsed, 'auto-submitted');
  if (auto && auto.toLowerCase() !== 'no') return null;
  // We support one return address; malformed/repeated requests and mandatory
  // extensions we cannot implement are ignored silently (RFC 8098 §2.2).
  const requested = headerAddresses(parsed, 'disposition-notification-to');
  if (
    requested.length !== 1 ||
    /(?:^|;)\s*[^=;]+\s*=\s*required\s*,/i.test(
      header(parsed, 'disposition-notification-options') ?? '',
    )
  )
    return null;
  const own = [box.email_address, ...box.aliases];
  const recipients = [
    ...(parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]) : []),
    ...(parsed.cc ? (Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]) : []),
  ].flatMap((a) => a.value.flatMap((v) => (v.address ? [v.address] : [])));
  const recipient =
    own.find((a) => recipients.some((b) => protocolAddressEqual(a, b))) ?? box.email_address;
  if (own.some((a) => protocolAddressEqual(a, requested[0]!))) return null;
  const returnPath = headerAddresses(parsed, 'return-path');
  if (header(parsed, 'return-path') === '<>') return null;
  const result = mdnRequestSchema.safeParse({
    to: requested[0],
    recipient,
    original_message_id: header(parsed, 'message-id'),
    return_path_matches:
      returnPath.length === 1 && protocolAddressEqual(returnPath[0]!, requested[0]!),
  });
  return result.success ? result.data : null;
}
export async function processMdnReceipt(
  db: Database,
  parsed: ParsedMail,
  tenantId: string,
  mailboxId: string,
  receiptMessageId: string,
) {
  if (!isMdnReport(parsed)) return [];
  const parts = parsed.attachments.filter(
    (a) => a.contentType.toLowerCase() === 'message/disposition-notification',
  );
  if (parts.length !== 1 || parts[0]!.size > 32768) return [];
  const receipt = parseMdnFields(parts[0]!.content.toString('utf8'));
  if (!receipt) return [];
  const originals = await db
    .selectFrom('messages')
    .select(['id', 'thread_id', 'to_addresses', 'cc_addresses', 'bcc_addresses'])
    .where('tenant_id', '=', tenantId)
    .where('mailbox_id', '=', mailboxId)
    .where('direction', '=', 'outbound')
    .where('request_read_receipt', '=', true)
    .where('message_id_header', '=', receipt.originalMessageId)
    .where('deleted_at', 'is', null)
    .execute();
  const threads: string[] = [];
  for (const original of originals) {
    const addresses = [
      ...(original.to_addresses as { address: string }[]),
      ...(original.cc_addresses as { address: string }[]),
      ...(original.bcc_addresses as { address: string }[]),
    ];
    if (!addresses.some((a) => a.address.trim().toLowerCase() === receipt.recipient)) continue;
    await db
      .insertInto('mdn_receipts')
      .values({
        tenant_id: tenantId,
        mailbox_id: mailboxId,
        original_message_id: original.id,
        receipt_message_id: receiptMessageId,
        recipient_address: receipt.recipient,
        disposition: receipt.disposition,
        reported_at: parsed.date && !isNaN(parsed.date.getTime()) ? parsed.date : null,
      })
      .onConflict((oc) =>
        oc.columns(['original_message_id', 'recipient_address', 'disposition']).doNothing(),
      )
      .execute();
    threads.push(original.thread_id);
  }
  return threads;
}
export function buildMdn(
  request: MdnRequest,
  messageId = `<${randomUUID()}@apmail.local>`,
  at = new Date(),
) {
  request = mdnRequestSchema.parse(request);
  messageIdSchema.parse(messageId);
  const boundary = 'apmail-mdn-' + randomUUID();
  const bodyText = 'A mensagem foi exibida. O destinatário autorizou esta confirmação de leitura.';
  const raw = Buffer.from(
    [
      `From: <${request.recipient}>`,
      `To: <${request.to}>`,
      `Date: ${at.toUTCString()}`,
      `Message-ID: ${messageId}`,
      'Subject: Read receipt',
      'Auto-Submitted: auto-replied',
      'MIME-Version: 1.0',
      `Content-Type: multipart/report; report-type=disposition-notification; boundary="${boundary}"`,
      '',
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: base64',
      '',
      Buffer.from(bodyText)
        .toString('base64')
        .match(/.{1,76}/g)!
        .join('\r\n'),
      `--${boundary}`,
      'Content-Type: message/disposition-notification',
      'Content-Transfer-Encoding: 7bit',
      '',
      'Reporting-UA: apmail.local; APMail',
      `Final-Recipient: rfc822; ${request.recipient}`,
      `Original-Message-ID: ${request.original_message_id}`,
      'Disposition: manual-action/MDN-sent-manually; displayed',
      '',
      `--${boundary}--`,
      '',
    ].join('\r\n'),
  );
  return { raw, bodyText, messageId, envelope: { from: '', to: [request.to] } };
}
