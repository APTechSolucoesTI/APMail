import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { asJson, audit, lockStorageTenant, outboxJobId, sendJobOptions } from '@apmail/db';
import { mdnRequestSchema, messageIdSchema } from '@apmail/shared';
import { requireTenant, notFound, conflict } from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import { requireFolder } from '../authz/folders.js';
import type { Resources } from './resources.js';
import { mailEvents } from './mail.js';

export async function registerReadReceipts(app: FastifyInstance, r: Resources) {
  app.post('/api/messages/:id/read-receipt', async (req) => {
    const c = requireTenant(req.ctx),
      id = z.object({ id: z.uuid() }).parse(req.params).id;
    const { decision } = z
      .object({ decision: z.enum(['confirm', 'decline']) })
      .strict()
      .parse(req.body);
    const message = await r.db
      .selectFrom('messages')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!message) throw notFound();
    await requireMailboxPerm(c, r.db, message.mailbox_id, 'read');
    await requireFolder(c, r.db, message.mailbox_id, message.folder_id);
    if (decision === 'confirm') await requireMailboxPerm(c, r.db, message.mailbox_id, 'send');
    const request = mdnRequestSchema.safeParse(message.mdn_request);
    if (
      !request.success ||
      message.is_mdn ||
      message.direction !== 'inbound' ||
      !messageIdSchema.safeParse(message.message_id_header).success
    )
      throw conflict('Esta mensagem não possui um pedido válido de confirmação.');
    const row = await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      const old = await tx
        .selectFrom('mdn_decisions')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('mailbox_id', '=', message.mailbox_id)
        .where('message_id_header', '=', message.message_id_header)
        .executeTakeFirst();
      if (old) return old;
      const box = await tx
        .selectFrom('mailboxes')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('id', '=', message.mailbox_id)
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (
        !box ||
        ![box.email_address, ...box.aliases]
          .map((a) => a.toLowerCase())
          .includes(request.data.recipient)
      )
        throw conflict('A identidade destinatária não está disponível nesta caixa.');
      if (decision === 'confirm' && (box.status !== 'active' || box.receiving_protocol === 'local'))
        throw conflict('A caixa precisa estar conectada ao SMTP para confirmar a leitura.');
      const outbox =
        decision === 'confirm'
          ? await tx
              .insertInto('outbox')
              .values({
                tenant_id: c.tenantId,
                mailbox_id: message.mailbox_id,
                created_by: c.userId,
                mdn_original_message_id: message.id,
                request_read_receipt: false,
                thread_id: message.thread_id,
                subject: 'Confirmação de leitura',
                to_addresses: asJson([{ address: request.data.to, name: '' }]),
                status: 'queued',
                send_after: new Date(),
                submit_count: 1,
              })
              .returningAll()
              .executeTakeFirstOrThrow()
          : null;
      if (outbox) {
        outbox.job_id = outboxJobId(outbox.id, 1);
        await tx
          .updateTable('outbox')
          .set({ job_id: outbox.job_id })
          .where('id', '=', outbox.id)
          .execute();
      }
      const result = await tx
        .insertInto('mdn_decisions')
        .values({
          tenant_id: c.tenantId,
          mailbox_id: message.mailbox_id,
          message_id_header: message.message_id_header,
          original_message_id: id,
          recipient_address: request.data.recipient,
          notification_to: request.data.to,
          decision,
          actor_id: c.userId,
          outbox_id: outbox?.id ?? null,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: decision === 'confirm' ? 'mdn.confirmed' : 'mdn.declined',
        entityType: 'message',
        entityId: id,
        ip: c.ip,
      });
      return result;
    });
    if (row.outbox_id) {
      const outbox = await r.db
        .selectFrom('outbox')
        .selectAll()
        .where('id', '=', row.outbox_id)
        .executeTakeFirstOrThrow();
      if (outbox.status === 'queued')
        await r.queues['outbox-send']
          .add('send', { outbox_id: outbox.id }, sendJobOptions(outbox))
          .catch(() => app.log.warn('MDN persistida; recuperação da fila pendente.'));
    }
    mailEvents(r, message.mailbox_id, [message.thread_id]);
    return { decision: row.decision, outbox_id: row.outbox_id };
  });
}
