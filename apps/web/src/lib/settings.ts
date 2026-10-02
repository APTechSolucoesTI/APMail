import { isTenantAdmin } from '@apmail/shared';
import { canDelegate } from '@apmail/shared';
import { requireCompany } from './auth';
import { ApiError } from './api';
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
  if (
    !isTenantAdmin(tenant?.role) &&
    !canDelegate(tenant?.role ?? null, tenant?.capabilities, capability)
  )
    throw new ApiError(403, 'forbidden', 'Você não tem permissão para acessar esta configuração.');
  return me;
}
