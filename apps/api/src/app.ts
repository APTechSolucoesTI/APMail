import Fastify, {LogController} from 'fastify';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { Redis } from 'ioredis';
import { createDb, createQueues } from '@apmail/db';
import { healthSchema, healthQueuesSchema, socketRedisKey } from '@apmail/shared';
import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { readEnv, type ApiEnv } from './env.js';
import { ZodError } from 'zod';
import { installAuth } from './plugins/auth.js';
import { installSocket } from './plugins/socket.js';
import { registerAuthRoutes } from './modules/auth.js';
import { registerTenantRoutes } from './modules/tenants.js';
import { registerMailboxRoutes } from './modules/mailboxes.js';
import { registerInvitationRoutes } from './modules/invitations.js';
import { registerAvatarRoutes } from './modules/avatars.js';
import { registerMailRoutes } from './modules/mail.js';
import { registerOutboxRoutes } from './modules/outbox.js';
import { registerOrganizationRoutes } from './modules/organization/routes.js';
import { registerThreadOperations } from './modules/thread-operations/routes.js';
import { registerDashboard } from './modules/dashboard/routes.js';
import { registerChat } from './modules/chat/routes.js';
import { ApiError, requireTenantAdmin } from './authz/context.js';

export async function buildApp(config: ApiEnv = readEnv()) {
  const app = Fastify({
    trustProxy: true,
    genReqId: () => randomUUID(),
    logController:new LogController({requestIdLogLabel:'request_id'}),
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'body.password',
              'body.token',
              'password',
              'encrypted_password',
            ],
          },
  }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  const db = createDb(config.DATABASE_URL);
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: 1 });
  redis.on('error', () => app.log.warn('Conexão com Redis indisponível.'));
  const queueResources = createQueues(config.REDIS_URL);
  await app.register(helmet);
  await app.register(sensible);
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, {
    redis,
    max: 300,
    timeWindow: '1 minute',
    hook: 'preHandler',
    keyGenerator: (req) => req.ctx?.userId ?? req.ip,
  });
  if (config.NODE_ENV === 'development') {
    await app.register(swagger, {
      openapi: { info: { title: 'APMail', version: '0.0.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  }
  app.setErrorHandler((error, request, reply) => {
    const e = error as {
      validation?: unknown;
      statusCode?: number;
      message?: string;
      code?: string;
    };
    if (error instanceof ZodError) {
      reply.code(400).send({
        error: {
          code: 'validation_error',
          message: 'Confira os campos informados.',
          details: error.flatten().fieldErrors,
        },
      });
      return;
    }
    if (e.code === '23505') {
      reply.code(409).send({
        error: { code: 'conflict', message: 'Este e-mail ou identificador já está em uso.' },
      });
      return;
    }
    if (e.message === 'last_owner') {
      reply.code(409).send({
        error: {
          code: 'conflict',
          message: 'A empresa precisa de ao menos um proprietário ativo.',
        },
      });
      return;
    }
    const status = e.validation ? 400 : (e.statusCode ?? 500);
    if (status >= 500) request.log.error({ err: error }, 'Falha na requisição.');
    const code =
      (
        {
          400: 'validation_error',
          401: 'unauthenticated',
          403: 'forbidden',
          404: 'not_found',
          409: 'conflict',
          429: 'rate_limited',
        } as Record<number, string>
      )[status] ?? 'internal';
    reply.code(status).send({
      error: {
        code: error instanceof ApiError ? error.code : code,
        message:
          status >= 500
            ? 'Não foi possível concluir a operação. Tente novamente.'
            : status === 429
              ? 'Muitas tentativas. Aguarde alguns minutos.'
              : (e.message ?? 'Requisição inválida.'),
        ...(e.validation ? { details: e.validation } : {}),
      },
    });
  });
  app.setNotFoundHandler((_request, reply) =>
    reply.code(404).send({ error: { code: 'not_found', message: 'Recurso não encontrado.' } }),
  );
  app.get(
    '/api/health',
    { schema: { response: { 200: healthSchema, 503: healthSchema } } },
    async (_request, reply) => {
      const checks = await Promise.allSettled([sql`select 1`.execute(db), redis.ping()]);
      const dbStatus = checks[0]?.status === 'fulfilled' ? 'ok' : 'error';
      const redisStatus = checks[1]?.status === 'fulfilled' ? 'ok' : 'error';
      const healthy = dbStatus === 'ok' && redisStatus === 'ok';
      return reply.code(healthy ? 200 : 503).send({
        status: healthy ? 'ok' : 'error',
        db: dbStatus,
        redis: redisStatus,
        version: '0.0.0',
      });
    },
  );
  const pub = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const sub = pub.duplicate();
  const io = new Server(app.server, {
    path: '/socket.io',
    cors: { origin: config.APP_URL, credentials: true },
  });
  io.adapter(createAdapter(pub, sub, { key: socketRedisKey(config.REDIS_URL) }));
  const resources = { db, redis, io, queues: queueResources.queues, env: config };
  await installAuth(app, db, redis, config);
  app.get(
    '/api/health/queues',
    { schema: { response: { 200: healthQueuesSchema } } },
    async (req) => {
      requireTenantAdmin(req.ctx);
      const entries = await Promise.all(
        Object.entries(resources.queues).map(
          async ([name, queue]) =>
            [name, await queue.getJobCounts('waiting', 'active', 'delayed', 'failed')] as const,
        ),
      );
      return healthQueuesSchema.parse({
        queues: Object.fromEntries(entries),
        worker_last_heartbeat: await redis.get('worker:heartbeat'),
      });
    },
  );
  app.addHook('onSend', async (request, reply, payload) => {
    reply.header('X-Request-Id', request.id);
    return payload;
  });
  const sockets = installSocket(app, resources);
  await registerAuthRoutes(app, resources);
  await registerTenantRoutes(app, resources);
  await registerMailboxRoutes(app, resources);
  await registerInvitationRoutes(app, resources);
  await registerAvatarRoutes(app, resources);
  await registerMailRoutes(app, resources);
  await registerOutboxRoutes(app, resources);
  await registerOrganizationRoutes(app, resources);
  registerThreadOperations(app, resources);
  registerDashboard(app, resources);
  registerChat(app, resources);
  app.addHook('onClose', async () => {
    io.local.disconnectSockets(true);
    await sockets.drain();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.all([pub.quit(), sub.quit(), redis.quit(), queueResources.close(), db.destroy()]);
  });
  return app;
}
