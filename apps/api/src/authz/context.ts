import { isTenantAdmin } from '@apmail/shared';
import { canDelegate, type TenantRole } from '@apmail/shared';
export type RequestContext = {
  userId: string;
  tenantId: string | null;
  tenantRole: TenantRole | null;
  requestId: string;
  ip: string;
  sessionHash: string;
  mailboxRoles: Map<string, import('@apmail/shared').MailboxRole | null>;
  capabilities?: string[];
  platformAdmin?: boolean;
};
declare module 'fastify' {
  interface FastifyRequest {
    ctx: RequestContext | null;
  }
}
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export const notFound = () => new ApiError(404, 'not_found', 'Recurso não encontrado.');
export const conflict = (message: string) => new ApiError(409, 'conflict', message);
export const forbidden = () =>
  new ApiError(403, 'forbidden', 'Você não tem permissão para esta ação.');
export function requireAuth(ctx: RequestContext | null): RequestContext {
  if (!ctx) throw new ApiError(401, 'unauthenticated', 'Entre na sua conta para continuar.');
  return ctx;
}
export function requireTenant(
  ctx: RequestContext | null,
): RequestContext & { tenantId: string; tenantRole: TenantRole } {
  const c = requireAuth(ctx);
  if (c.platformAdmin)
    throw new ApiError(403, 'platform_only', 'O superadmin atua somente na gestão da plataforma.');
  if (!c.tenantId || !c.tenantRole)
    throw new ApiError(409, 'no_tenant', 'Selecione ou crie uma empresa.');
  return c as RequestContext & { tenantId: string; tenantRole: TenantRole };
}
export function requireTenantAdmin(ctx: RequestContext | null) {
  const c = requireTenant(ctx);
  if (!isTenantAdmin(c.tenantRole)) throw forbidden();
  return c;
}
export function requireTenantOwner(ctx: RequestContext | null) {
  const c = requireTenant(ctx);
  if (c.tenantRole !== 'owner') throw forbidden();
  return c;
}
export function requireCapability(ctx: RequestContext | null, capability: string) {
  const c = requireTenant(ctx);
  if (!isTenantAdmin(c.tenantRole) && !canDelegate(c.tenantRole, c.capabilities, capability))
    throw forbidden();
  return c;
}
export function requireSuperAdmin(ctx: RequestContext | null) {
  const c = requireAuth(ctx);
  if (!c.platformAdmin) throw forbidden();
  return c;
}
