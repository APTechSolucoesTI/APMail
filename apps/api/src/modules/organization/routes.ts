import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { organizationService } from './service.js';
import type { Resources } from '../resources.js';
const id = (p: unknown) => z.object({ id: z.uuid() }).parse(p).id;
export async function registerOrganizationRoutes(app: FastifyInstance, r: Resources) {
  const s = organizationService(r);
  app.get('/api/labels', (req) => s.labels(req.ctx));
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
