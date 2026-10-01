import { requireCompany } from './auth';
import { ApiError } from './api';
export async function requireAdmin() {
  const me = await requireCompany();
  const tenant = me.tenants.find((t) => t.id === me.current_tenant_id);
  if (tenant?.role === 'member')
    throw new ApiError(
      403,
      'forbidden',
      'Somente administradores podem acessar esta configuração.',
    );
  return me;
}
