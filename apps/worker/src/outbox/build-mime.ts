import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { randomUUID } from 'node:crypto';
import { renderFromName, type Address } from '@apmail/shared';
import {
  resolveOutboxAttachments,
  prepareSignature,
  signatureCid,
  htmlToText,
  type OutboxRow,
} from '@apmail/db';
import type { Mailbox } from '../imap/connect.js';
import type { WorkerResources } from '../resources.js';
export async function buildMime(r: WorkerResources, row: OutboxRow, box: Mailbox) {
  const user = await r.db
    .selectFrom('users')
    .select('full_name')
    .where('id', '=', row.created_by)
    .executeTakeFirstOrThrow();
  const tenant = await r.db
    .selectFrom('tenants')
    .select('name')
    .where('id', '=', row.tenant_id)
    .executeTakeFirstOrThrow();
  const original = row.reply_to_message_id
    ? await r.db
        .selectFrom('messages')
        .select(['message_id_header', 'references_headers'])
        .where('id', '=', row.reply_to_message_id)
        .where('tenant_id', '=', row.tenant_id)
        .where('mailbox_id', '=', box.id)
        .executeTakeFirst()
    : null;
  const inReplyTo = ['reply', 'reply_all'].includes(row.kind)
    ? (original?.message_id_header ?? undefined)
    : undefined;
  const references = inReplyTo
    ? [...(original?.references_headers ?? []), inReplyTo].slice(-20)
    : [];
  const files = await resolveOutboxAttachments(r.db, row);
  const signature = await prepareSignature(
    r.db,
    row,
    files.flatMap((file) => (file.content_id ? [file.content_id] : [])),
  );
  for (const image of signature.images)
    files.push({
      ...image,
      filename: 'assinatura.png',
      is_inline: true,
      content_id: signatureCid(image.id),
      upload_id: null,
    });
  const bodyHtml = signature.bodyHtml;
  const bodyText = htmlToText(bodyHtml);
  const name = renderFromName(box.from_name_template, {
    user_name: user.full_name,
    mailbox_name: box.name,
    tenant_name: tenant.name,
  });
  const messageId = row.message_id_header ?? `<${randomUUID()}@${box.email_address.split('@')[1]}>`;
  const addresses = [
    ...(row.to_addresses as Address[]),
    ...(row.cc_addresses as Address[]),
    ...(row.bcc_addresses as Address[]),
  ];
  const attachments = await Promise.all(
    files.map(async (f) => ({
      filename: f.filename,
      content: await r.storage.openReadStream(f.storage_path),
      contentType: f.content_type,
      cid: f.content_id ?? undefined,
      contentDisposition: f.is_inline ? 'inline' : 'attachment',
    })),
  );
  const composer = new MailComposer({
    from: { name, address: box.email_address },
    to: row.to_addresses as Address[],
    cc: row.cc_addresses as Address[],
    bcc: row.bcc_addresses as Address[],
    subject: row.subject,
    html: bodyHtml,
    text: bodyText,
    messageId,
    inReplyTo,
    references,
    headers: { 'X-APMail-Outbox-Id': row.id },
    attachments,
    disableUrlAccess: true,
  });
  const raw = await composer.compile().build();
  return {
    raw,
    bodyHtml,
    bodyText,
    messageId,
    inReplyTo: inReplyTo ?? null,
    references,
    files,
    fromName: name,
    envelope: {
      from: box.email_address,
      to: [...new Set(addresses.map((a) => a.address.toLowerCase()))],
    },
  };
}
