import { isTenantAdmin } from '@apmail/shared';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  audit,
  asJson,
  touchThreads,
  resolveThread,
  messageSnippet,
  sanitizeEmailHtml,
  userCanReadThread,
} from '@apmail/db';
import { can, type Address } from '@apmail/shared';
import { UnrecoverableError, type Job } from 'bullmq';
import type { WorkerResources } from '../resources.js';
import { transports } from '../imap/connect.js';
import { buildMime } from '../outbox/build-mime.js';
import { withMailboxLock } from '../lib/mailbox-lock.js';
import { markMailboxError } from './mailbox-connection.js';
import { connectionError } from '../lib/errors.js';
import { emitThreads } from '../lib/events.js';
export async function handleOutboxSend(
  r: WorkerResources,
  id: string,
  job: Pick<Job, 'id' | 'attemptsMade' | 'opts'>,
) {
  const row = await r.db
    .updateTable('outbox')
    .set({ status: 'sending', attempts: sql`attempts+1` })
    .where('id', '=', id)
    .where('status', 'in', ['queued', 'scheduled'])
    .where('job_id', '=', job.id!)
    .where('send_after', '<=', new Date())
    .returningAll()
    .executeTakeFirst();
  if (!row) return;
  let transport: Awaited<ReturnType<typeof transports>> | undefined;
  let delivered = false;
  try {
    const tenant = await r.db
      .selectFrom('tenants')
      .select('id')
      .where('id', '=', row.tenant_id)
      .where('deleted_at', 'is', null)
      .where('suspended_at', 'is', null)
      .executeTakeFirst();
    if (!tenant) throw new Error('tenant_unavailable');
    const platform = await r.db
      .selectFrom('platform_admins')
      .select('user_id')
      .where('user_id', '=', row.created_by)
      .executeTakeFirst();
    if (platform) throw new Error('send_permission_revoked');
    const box = await r.db
      .selectFrom('mailboxes')
      .selectAll()
      .where('id', '=', row.mailbox_id)
      .where('tenant_id', '=', row.tenant_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!box || box.status !== 'active') throw new Error('mailbox_unavailable');
    const membership = await r.db
      .selectFrom('tenant_members')
      .select(['role', 'status'])
      .where('user_id', '=', row.created_by)
      .where('tenant_id', '=', row.tenant_id)
      .executeTakeFirst();
    const access = await r.db
      .selectFrom('mailbox_members')
      .select('role')
      .where('user_id', '=', row.created_by)
      .where('mailbox_id', '=', box.id)
      .executeTakeFirst();
    if (
      !membership ||
      membership.status !== 'active' ||
      (!isTenantAdmin(membership.role) && (!access || !can(access.role, 'send')))
    )
      throw new Error('send_permission_revoked');
    if (
      row.thread_id &&
      !(await userCanReadThread(
        r.db,
        row.tenant_id,
        box.id,
        row.created_by,
        row.thread_id,
        row.reply_to_message_id ?? undefined,
      ))
    )
      throw new Error('send_permission_revoked');
    for (const ref of row.attachments as { source: string; attachment_id?: string }[]) {
      if (ref.source !== 'message_attachment' || !ref.attachment_id) continue;
      const file = await r.db
        .selectFrom('attachments as a')
        .innerJoin('messages as m', 'm.id', 'a.message_id')
        .select(['m.thread_id', 'm.id'])
        .where('a.id', '=', ref.attachment_id)
        .where('a.tenant_id', '=', row.tenant_id)
        .where('a.mailbox_id', '=', box.id)
        .executeTakeFirst();
      if (
        !file ||
        !(await userCanReadThread(
          r.db,
          row.tenant_id,
          box.id,
          row.created_by,
          file.thread_id,
          file.id,
        ))
      )
        throw new Error('send_permission_revoked');
    }
    const mime = await buildMime(r, row, box);
    await r.db
      .updateTable('outbox')
      .set({ message_id_header: mime.messageId })
      .where('id', '=', id)
      .execute();
    transport = await transports(r.db, box, r.env);
    const locked = await withMailboxLock(
      r.redis,
      box.id,
      job.id!,
      async () => {
        await transport!.smtp.sendMail({ envelope: mime.envelope, raw: mime.raw });
        delivered = true;
        const sent = await r.db
          .selectFrom('folders')
          .select(['id', 'imap_path'])
          .where('tenant_id', '=', box.tenant_id)
          .where('mailbox_id', '=', box.id)
          .where('special_use', '=', 'sent')
          .where('deleted_at', 'is', null)
          .executeTakeFirst();
        if (box.append_sent_copy && sent)
          try {
            await transport!.imap.connect();
            await transport!.imap.append(sent.imap_path, mime.raw, ['\\Seen']);
          } catch {
            r.log.warn({ outbox_id: id }, 'Enviado; não foi possível salvar a cópia no IMAP.');
          }
        const messageId = randomUUID(),
          written: string[] = [];
        try {
          await r.db.transaction().execute(async (tx) => {
            const at = new Date(),
              text = mime.bodyText;
            const metadata = {
              tenant_id: box.tenant_id,
              mailbox_id: box.id,
              subject: row.subject,
              message_at: at,
              in_reply_to: mime.inReplyTo,
              references_headers: mime.references,
              from_address: box.email_address,
              to_addresses: row.to_addresses as Address[],
              cc_addresses: row.cc_addresses as Address[],
            };
            const threadId =
              row.thread_id ??
              (await resolveThread(tx, metadata, [box.email_address, ...box.aliases]));
            await tx
              .updateTable('threads')
              .set({ history_queue_eligible: true })
              .where('id', '=', threadId)
              .execute();
            await tx
              .insertInto('messages')
              .values({
                ...metadata,
                id: messageId,
                thread_id: threadId,
                folder_id: sent?.id ?? null,
                imap_uid: null,
                message_id_header: mime.messageId,
                from_name: mime.fromName,
                to_addresses: asJson(row.to_addresses),
                cc_addresses: asJson(row.cc_addresses),
                bcc_addresses: asJson(row.bcc_addresses),
                reply_to_addresses: asJson([]),
                body_html: sanitizeEmailHtml(mime.bodyHtml, text),
                body_text: text,
                snippet: messageSnippet(text),
                direction: 'outbound',
                is_automated: !!row.created_by_rule_id,
                has_attachments: mime.files.some((f) => !f.is_inline),
                size_bytes: mime.raw.length,
                sent_by_user_id: row.created_by,
                outbox_id: row.id,
              })
              .execute();
            for (const file of mime.files) {
              const attachmentId = randomUUID(),
                path = `attachments/${box.tenant_id}/${box.id}/${messageId}/${attachmentId}`;
              await r.storage.copyFile(file.storage_path, path);
              written.push(path);
              await tx
                .insertInto('attachments')
                .values({
                  id: attachmentId,
                  tenant_id: box.tenant_id,
                  mailbox_id: box.id,
                  message_id: messageId,
                  filename: file.filename,
                  content_type: file.content_type,
                  size_bytes: file.size_bytes,
                  storage_path: path,
                  content_id: file.content_id,
                  is_inline: file.is_inline,
                })
                .execute();
              if (file.upload_id)
                await tx
                  .updateTable('uploads')
                  .set({ consumed_at: at })
                  .where('id', '=', file.upload_id)
                  .execute();
            }
            await tx
              .updateTable('outbox')
              .set({
                status: 'sent',
                sent_at: at,
                sent_message_id: messageId,
                message_id_header: mime.messageId,
                thread_id: threadId,
                last_error: null,
              })
              .where('id', '=', id)
              .execute();
            await touchThreads(tx, [threadId], 'outbound', row.created_by);
            await audit(tx, {
              tenantId: row.tenant_id,
              actorId: row.created_by,
              action: 'message.sent',
              entityType: 'message',
              entityId: messageId,
            });
            emitThreads(r, box.id, [threadId]);
          });
        } catch (e) {
          await Promise.all(written.map((p) => r.storage.removeFile(p)));
          throw e;
        }
        for (const file of mime.files)
          if (file.upload_id)
            await r.storage
              .removeFile(file.storage_path)
              .catch(() =>
                r.log.warn({ upload_id: file.upload_id }, 'Limpeza do upload pendente.'),
              );
      },
      30000,
    );
    if (locked === 'skipped')
      throw new Error('A caixa está ocupada. O envio será tentado novamente.');
    r.io
      .to(`mailbox:${row.mailbox_id}`)
      .emit('outbox:changed', { mailbox_id: row.mailbox_id, outbox_id: id });
  } catch (error) {
    const e = error as { code?: string; authenticationFailed?: boolean; responseCode?: number };
    const auth = !!e.authenticationFailed || e.code === 'EAUTH' || e.responseCode === 535;
    const last =
      auth ||
      delivered ||
      job.attemptsMade + 1 >= (job.opts.attempts ?? 1) ||
      ['mailbox_unavailable', 'send_permission_revoked', 'tenant_unavailable'].includes(
        (error as Error).message,
      );
    const message = delivered
      ? 'O SMTP aceitou o envio, mas a confirmação local falhou. Verifique Enviados antes de tentar novamente.'
      : (error as Error).message === 'tenant_unavailable'
        ? 'A empresa está suspensa ou indisponível. Retome o acesso antes de tentar novamente.'
        : (error as Error).message === 'mailbox_unavailable'
          ? 'A caixa está indisponível.'
          : (error as Error).message === 'send_permission_revoked'
            ? 'O acesso de envio foi removido.'
            : connectionError(error, 'SMTP', 0);
    await r.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('outbox')
        .set({ status: last ? 'failed' : 'queued', last_error: message })
        .where('id', '=', id)
        .where('status', '=', 'sending')
        .execute();
      if (row.thread_id) await touchThreads(tx, [row.thread_id], 'schedule', row.created_by);
      if (last)
        await tx
          .insertInto('notifications')
          .values({
            tenant_id: row.tenant_id,
            user_id: row.created_by,
            type: 'send_failed',
            title: `Não foi possível enviar: ${row.subject || '(sem assunto)'}`,
            body: message,
            link: '/scheduled?tab=failed',
          })
          .execute();
    });
    if (auth) {
      const box = await r.db
        .selectFrom('mailboxes')
        .selectAll()
        .where('id', '=', row.mailbox_id)
        .executeTakeFirst();
      if (box) await markMailboxError(r, box, error, box.smtp_host, box.smtp_port);
    }
    r.io
      .to(`mailbox:${row.mailbox_id}`)
      .emit('outbox:changed', { mailbox_id: row.mailbox_id, outbox_id: id });
    r.io.to(`user:${row.created_by}`).emit('notifications:changed', {});
    if (last) throw new UnrecoverableError(message);
    throw new Error(message, { cause: error });
  } finally {
    await transport?.close();
  }
}
