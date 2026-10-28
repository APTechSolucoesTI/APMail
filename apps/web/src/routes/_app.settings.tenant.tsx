import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/_app/settings/tenant')({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ location }) => {
    throw redirect({
      to: location.pathname.replace('/settings/tenant', '/admin/company'),
      search: location.search,
      replace: true,
    });
  },
});
