import type { FastifyInstance } from 'fastify';
import type { Resources } from '../resources.js';
import { dashboardScope } from './service.js';
import { kpis, dailyVolume, byFolder, dashboardQueues, byUser, staleThreads } from './queries.js';
export function registerDashboard(app: FastifyInstance, r: Resources) {
  for (const [path, query] of [
    ['kpis', kpis],
    ['daily-volume', dailyVolume],
    ['by-folder', byFolder],
    ['queue-counts', dashboardQueues],
    ['by-user', byUser],
    ['stale-threads', staleThreads],
  ] as const)
    app.get('/api/dashboard/' + path, async (req) =>
      query(r, await dashboardScope(r, req.ctx, req.query)),
    );
}
