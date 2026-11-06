import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../authz/context.js';
import { hashToken } from '../plugins/auth.js';
import type { Resources } from './resources.js';

export function integrationApiAccess(app: FastifyInstance, r: Resources) {
  const scopes = new WeakMap<FastifyRequest, { id: string; tenantId: string }>();
  const throttleInvalid = app.rateLimit({
    max: 60,
    timeWindow: '1 minute',
    keyGenerator: (req) => 'notification-invalid:' + req.ip,
  });

  return {
    scope: (req: FastifyRequest) => scopes.get(req)!,
    requirePermission: (permission: string) => async (req: FastifyRequest, reply: FastifyReply) => {
      reply.header('Cache-Control', 'no-store').header('Vary', 'Authorization');
      if (r.env.NODE_ENV === 'production' && req.protocol !== 'https') {
        throw new ApiError(403, 'https_required', 'Utilize HTTPS para consultar esta API.');
      }
      const match = /^Bearer (apmail_(?:api|ntf)_[A-Za-z0-9_-]{43})$/i.exec(
        req.headers.authorization ?? '',
      );
      const row = match
        ? await r.db
            .selectFrom('integration_api_tokens as i')
            .innerJoin('tenants as t', 't.id', 'i.tenant_id')
            .select(['i.id', 'i.tenant_id', 'i.permissions'])
            .where('i.token_hash', '=', hashToken(match[1]!))
            .where('i.revoked_at', 'is', null)
            .where('i.expires_at', '>', new Date())
            .where('t.deleted_at', 'is', null)
            .where('t.suspended_at', 'is', null)
            .executeTakeFirst()
        : undefined;
      if (!row) {
        await throttleInvalid.call(app, req, reply);
        if (reply.sent) return;
        reply.header('WWW-Authenticate', 'Bearer');
        throw new ApiError(
          401,
          'invalid_integration_token',
          'Token de integração inválido ou indisponível.',
        );
      }
      if (!row.permissions.includes(permission)) {
        await throttleInvalid.call(app, req, reply);
        if (reply.sent) return;
        throw new ApiError(
          403,
          'integration_route_forbidden',
          'Esta chave não tem permissão para acessar esta rota.',
        );
      }
      scopes.set(req, { id: row.id, tenantId: row.tenant_id });
    },
  };
}
