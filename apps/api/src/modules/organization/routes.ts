import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { mailRuleSchema, evaluateConditions, type Address } from '@apmail/shared';
import { requireTenant, ApiError } from '../../authz/context.js';
import { requireMailboxPerm } from '../../authz/guards.js';
import { requireFolder, readableFolders, folderPredicate } from '../../authz/folders.js';
import { organizationService } from './service.js';
import type { Resources } from '../resources.js';
const id = (p: unknown) => z.object({ id: z.uuid() }).parse(p).id;
export async function registerOrganizationRoutes(app: FastifyInstance, r: Resources) {
  const s = organizationService(r);
  app.post('/api/rules/preview', async (req) => {
    const c = requireTenant(req.ctx),
      b = z
        .object({
          rule: mailRuleSchema,
          message_id: z.uuid().optional(),
          thread_id: z.uuid().optional(),
        })
        .refine(
          (value) => !!value.message_id !== !!value.thread_id,
          'Selecione uma conversa ou mensagem para testar.',
        )
        .parse(req.body);
    await requireMailboxPerm(
      c,
      r.db,
      b.rule.mailbox_id,
      b.rule.scope === 'personal' ? 'read' : 'rules',
    );
    const scope = await readableFolders(c, r.db, b.rule.mailbox_id);
    const msg = await r.db
      .selectFrom('messages as m')
      .selectAll('m')
      .where('m.tenant_id', '=', c.tenantId)
      .where('m.mailbox_id', '=', b.rule.mailbox_id)
      .$if(!!b.message_id, (query) => query.where('m.id', '=', b.message_id!))
      .$if(!!b.thread_id, (query) =>
        query.where('m.thread_id', '=', b.thread_id!).where('m.direction', '=', 'inbound'),
      )
      .where('m.deleted_at', 'is', null)
      .where(folderPredicate(scope))
      .orderBy('m.message_at', 'desc')
      .orderBy('m.id', 'desc')
      .executeTakeFirst();
    if (!msg)
      throw new ApiError(
        404,
        'preview_message_missing',
        'Esta conversa não tem uma mensagem recebida disponível nesta caixa. Selecione outra conversa.',
      );
    await requireFolder(c, r.db, msg.mailbox_id, msg.folder_id);
    const input = {
      from_name: msg.from_name,
      from_address: msg.from_address,
      to_addresses: msg.to_addresses as Address[],
      cc_addresses: msg.cc_addresses as Address[],
      subject: msg.subject,
      body_text: msg.body_text,
      has_attachments: msg.has_attachments,
    };
    return {
      matches: evaluateConditions(b.rule, input),
      conditions: b.rule.conditions.map((condition) =>
        evaluateConditions({ match_mode: 'all', conditions: [condition] }, input),
      ),
    };
  });
  app.get('/api/labels', (req) => s.labels(req.ctx, req.query));
  app.post('/api/labels', async (req, res) =>
    res.code(201).send(await s.saveLabel(req.ctx, null, req.body)),
  );
  app.patch('/api/labels/:id', (req) => s.saveLabel(req.ctx, id(req.params), req.body));
  app.delete('/api/labels/:id', async (req, res) => {
    await s.deleteLabel(req.ctx, id(req.params));
    return res.code(204).send();
  });
  app.put('/api/threads/:id/labels', (req) => s.threadLabels(req.ctx, id(req.params), req.body));
  app.get('/api/rules', (req) => s.rules(req.ctx, req.query));
  app.post('/api/rules', async (req, res) =>
    res.code(201).send(await s.saveRule(req.ctx, null, req.body)),
  );
  app.patch('/api/rules/:id', (req) => s.saveRule(req.ctx, id(req.params), req.body));
  app.delete('/api/rules/:id', async (req, res) => {
    await s.deleteRule(req.ctx, id(req.params));
    return res.code(204).send();
  });
  app.post('/api/mailboxes/:id/folders', async (req, res) =>
    res.code(202).send(await s.folderAction(req.ctx, 'create_folder', id(req.params), req.body)),
  );
  app.patch('/api/folders/:id', async (req, res) =>
    res.code(202).send(await s.folderAction(req.ctx, 'rename_folder', id(req.params), req.body)),
  );
  app.delete('/api/folders/:id', async (req, res) =>
    res.code(202).send(await s.folderAction(req.ctx, 'delete_folder', id(req.params), null)),
  );
}
