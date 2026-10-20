import type { FastifyInstance } from 'fastify';
import { audit, type Json } from '@apmail/db';
import type { Resources } from '../modules/resources.js';

/** Additional successful mutations; message delivery and mailbox actions use transactional audit. */
export function installActivityAudit(app: FastifyInstance, r: Resources) {
  app.addHook('onSend', async (req, reply, payload) => {
    const c = req.ctx;
    if (
      !c?.tenantId ||
      c.platformAdmin ||
      !['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ||
      reply.statusCode >= 300
    )
      return payload;
    const path = req.url.split('?')[0]!;
    let kind: string | null = null,
      entity = '';
    if (/^\/api\/calendar\/events(?:\/[^/]+(?:\/occurrence)?)?$/.test(path)) {
      kind = 'calendar';
      entity = 'calendar_event';
    } else if (/^\/api\/messages\/[^/]+\/calendar\/respond$/.test(path)) {
      kind = 'calendar.responded';
      entity = 'message';
    } else if (/^\/api\/reminders(?:\/[^/]+(?:\/action)?)?$/.test(path)) {
      kind = path.endsWith('/action') ? 'reminder.action' : 'reminder';
      entity = 'reminder';
    } else if (/^\/api\/signatures(?:\/[^/]+)?$/.test(path)) {
      kind = 'signature';
      entity = 'signature';
    } else if (/^\/api\/threads\/[^/]+\/notes$/.test(path)) {
      kind = 'note.created';
      entity = 'thread';
    } else if (/^\/api\/integrations\/google(?:\/(?:meet\/preferences|connect))?$/.test(path)) {
      kind = req.method === 'DELETE' ? 'integration.disconnected' : 'integration.updated';
      entity = 'integration';
    } else if (path === '/api/preferences') {
      kind = 'preferences.updated';
      entity = 'user';
    }
    if (!kind) return payload;
    const input =
      req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const metadata = Object.fromEntries(
      Object.entries(input).filter(([key]) =>
        [
          'title',
          'name',
          'subject',
          'starts_at',
          'ends_at',
          'all_day',
          'timezone',
          'action',
          'response',
          'remind_before_minutes',
          'theme',
          'mail_queues_enabled',
          'request_read_receipt',
          'notify_mentions',
          'notify_chat',
          'notify_assignments',
          'desktop_notifications',
        ].includes(key),
      ),
    );
    let response: Record<string, unknown> = {};
    if (typeof payload === 'string') {
      try {
        const parsed: unknown = JSON.parse(payload);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
          response = parsed as Record<string, unknown>;
      } catch {
        /* DELETE may not return JSON. */
      }
    }
    const params = req.params as { id?: string } | undefined;
    const id = typeof response.id === 'string' ? response.id : params?.id;
    const action = kind.includes('.')
      ? kind
      : kind +
        (req.method === 'DELETE'
          ? '.deleted'
          : req.method === 'POST' && !params?.id
            ? '.created'
            : '.updated');
    await audit(r.db, {
      tenantId: c.tenantId,
      actorId: c.userId,
      action,
      entityType: entity,
      entityId: entity === 'user' ? c.userId : (id ?? null),
      metadata: JSON.parse(JSON.stringify({ ...metadata, outcome: 'completed' })) as Json,
      ip: c.ip,
      requestId: req.id,
    });
    return payload;
  });
}
