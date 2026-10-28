import { createFileRoute, Outlet, redirect } from '@tanstack/react-router';
import { requireCompany } from '@/lib/auth';
import { canAccessAdmin } from '@/lib/admin';
export const Route = createFileRoute('/_app/admin')({
  beforeLoad: async () => {
    const me = await requireCompany();
    if (!canAccessAdmin(me.tenants.find((t) => t.id === me.current_tenant_id) ?? {}))
      throw redirect({ to: '/' });
  },
  component: Outlet,
});
