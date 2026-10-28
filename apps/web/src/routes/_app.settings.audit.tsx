import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/_app/settings/audit')({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ location }) => {
    throw redirect({
      to: location.pathname.replace('/settings/audit', '/admin/audit'),
      search: location.search,
      replace: true,
    });
  },
});
