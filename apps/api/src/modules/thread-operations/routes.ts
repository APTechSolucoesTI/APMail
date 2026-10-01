import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { threadAssigneeSchema } from '@apmail/shared';
import type { Resources } from '../resources.js';
import {
  changeThread,
  deleteNote,
  noteThread,
  saveNote,
  threadHistory,
  threadNotes,
} from './service.js';
const idOf = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
export function registerThreadOperations(app: FastifyInstance, r: Resources) {
  for (const action of ['done', 'reopen'] as const)
    app.post('/api/threads/:id/' + action, (req) =>
      changeThread(r, req.ctx, idOf(req.params), action),
    );
  app.put('/api/threads/:id/queue-excluded', (req) =>
    changeThread(
      r,
      req.ctx,
      idOf(req.params),
      'excluded',
      z.object({ excluded: z.boolean() }).parse(req.body).excluded,
    ),
  );
  app.put('/api/threads/:id/assignee', (req) =>
    changeThread(
      r,
      req.ctx,
      idOf(req.params),
      'assign',
      threadAssigneeSchema.parse(req.body).user_id,
    ),
  );
  app.get('/api/threads/:id/history', (req) => threadHistory(r, req.ctx, idOf(req.params)));
  app.get('/api/threads/:id/notes', (req) => threadNotes(r, req.ctx, idOf(req.params)));
  app.post('/api/threads/:id/notes', async (req, reply) =>
    reply.code(201).send(await saveNote(r, req.ctx, idOf(req.params), req.body)),
  );
  app.patch('/api/notes/:id', async (req) => {
    const id = idOf(req.params),
      note = await noteThread(r, req.ctx, id);
    return saveNote(r, req.ctx, note.thread_id, req.body, id);
  });
  app.delete('/api/notes/:id', (req) => deleteNote(r, req.ctx, idOf(req.params)));
}
