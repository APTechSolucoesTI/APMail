import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { folderPredicate, readableFolders } from '../authz/folders.js';
import { notFound } from '../authz/context.js';
import { requireThread } from './mail.js';
import type { Resources } from './resources.js';
import { conversationPdf } from './conversation-pdf.js';
import { conversationPdfImages } from './conversation-pdf-images.js';

export async function registerThreadPdf(app: FastifyInstance, resources: Resources) {
  app.get('/api/threads/:id/pdf', async (request, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { thread, c } = await requireThread(request.ctx, resources, id);
    const scope = await readableFolders(c, resources.db, thread.mailbox_id);
    // Printing always covers the complete readable conversation, independent of the UI selection.
    const messages = await resources.db
      .selectFrom('messages as m')
      .select([
        'm.id',
        'm.message_id_header',
        'm.subject',
        'm.from_name',
        'm.from_address',
        'm.to_addresses',
        'm.cc_addresses',
        'm.bcc_addresses',
        'm.message_at',
        'm.body_text',
        'm.body_html',
      ])
      .where('m.tenant_id', '=', c.tenantId)
      .where('m.mailbox_id', '=', thread.mailbox_id)
      .where('m.thread_id', '=', id)
      .where('m.deleted_at', 'is', null)
      .where(folderPredicate(scope))
      .orderBy('m.message_at', 'asc')
      .orderBy('m.id')
      .execute();
    if (!messages.length) throw notFound();
    const attachments = await resources.db
      .selectFrom('attachments')
      .select(['id', 'message_id', 'filename', 'content_id', 'storage_path', 'size_bytes'])
      .where('tenant_id', '=', c.tenantId)
      .where('mailbox_id', '=', thread.mailbox_id)
      .where(
        'message_id',
        'in',
        messages.map((message) => message.id),
      )
      .orderBy('filename')
      .orderBy('id')
      .execute();
    const preferences = await resources.db
      .selectFrom('user_preferences')
      .select('timezone')
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    const pdf = await conversationPdf({
      timezone: preferences?.timezone ?? 'America/Sao_Paulo',
      subject: scope === null ? thread.subject : messages.at(-1)!.subject,
      messages: await conversationPdfImages(
        resources,
        c.tenantId,
        messages.map((message) => ({
          ...message,
          attachments: attachments.filter((attachment) => attachment.message_id === message.id),
        })),
        attachments,
      ),
    });
    return reply
      .header('Cache-Control', 'private, no-store')
      .header('Content-Disposition', `inline; filename="apmail-conversa-${id}.pdf"`)
      .type('application/pdf')
      .send(pdf);
  });
}
