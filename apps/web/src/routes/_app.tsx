import { createFileRoute } from '@tanstack/react-router';
import { requireCompany } from '@/lib/auth';
import { AppShell } from '@/components/layout/app-shell';
import { hasAccess, screenPermission } from '@apmail/shared';
import { ApiError } from '@/lib/api';
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => {
    const me = await requireCompany(),
      tenant = me.tenants.find((t) => t.id === me.current_tenant_id),
      permission = screenPermission(location.pathname);
    if (tenant?.access_permissions != null && permission && !hasAccess(tenant, permission))
      throw new ApiError(403, 'forbidden', 'Seu perfil não permite acessar esta tela.');
    return me;
  },
  component: AppShell,
});
