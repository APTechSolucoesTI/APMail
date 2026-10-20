import { isTenantAdmin } from '@apmail/shared';
import { canDelegate } from '@apmail/shared';
import { requireCompany } from './auth';
import { ApiError } from './api';
import { hasAccess, type AccessPermission } from '@apmail/shared';
export async function requireSettingsPermission(permission: AccessPermission) {
  const me = await requireCompany(),
    tenant = me.tenants.find((t) => t.id === me.current_tenant_id);
  if (!hasAccess(tenant, permission))
    throw new ApiError(403, 'forbidden', 'Você não tem permissão para acessar esta configuração.');
  return me;
}
export async function requireAdmin() {
  const me = await requireCompany();
  const tenant = me.tenants.find((t) => t.id === me.current_tenant_id);
  if (!isTenantAdmin(tenant?.role))
    throw new ApiError(
      403,
      'forbidden',
      'Somente administradores podem acessar esta configuração.',
    );
  return me;
}
export async function requireSettingsCapability(capability: string) {
  const me = await requireCompany(),
    tenant = me.tenants.find((t) => t.id === me.current_tenant_id);
  if (tenant?.access_profile_id) {
    const permission = (
      { members: 'users.view', audit: 'audit.view' } as Record<string, AccessPermission>
    )[capability];
    if (!permission || !hasAccess(tenant, permission))
      throw new ApiError(
        403,
        'forbidden',
        'Você não tem permissão para acessar esta configuração.',
      );
    return me;
  }
  if (
    !isTenantAdmin(tenant?.role) &&
    !canDelegate(tenant?.role ?? null, tenant?.capabilities, capability)
  )
    throw new ApiError(403, 'forbidden', 'Você não tem permissão para acessar esta configuração.');
  return me;
}
