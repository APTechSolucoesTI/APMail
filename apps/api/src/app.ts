import Fastify from 'fastify';
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
import { healthSchema } from '@apmail/shared';
import { sql } from 'kysely';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { readEnv, type ApiEnv } from './env.js';

export async function buildApp(config: ApiEnv = readEnv()) {
  const app = Fastify({
    trustProxy: true,
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
  await app.register(rateLimit, { redis, max: 300, timeWindow: '1 minute' });
  if (config.NODE_ENV === 'development') {
    await app.register(swagger, {
      openapi: { info: { title: 'APMail', version: '0.0.0' } },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, { routePrefix: '/api/docs' });
  }
  app.setErrorHandler((error, _request, reply) => {
    const e = error as { validation?: unknown; statusCode?: number; message?: string };
    const status = e.validation ? 400 : (e.statusCode ?? 500);
    if (status >= 500) app.log.error({ err: error }, 'Falha na requisição.');
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
    reply
      .code(status)
      .send({
        error: {
          code,
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
      return reply
        .code(healthy ? 200 : 503)
        .send({
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
  io.adapter(createAdapter(pub, sub));
  // Nenhuma conexão anônima; a validação de sessão será adicionada na Fase 1.
  io.use((_socket, next) => next(new Error('unauthenticated')));
  app.addHook('onClose', async () => {
    io.disconnectSockets(true);
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.all([pub.quit(), sub.quit(), redis.quit(), queueResources.close(), db.destroy()]);
  });
  return app;
}
