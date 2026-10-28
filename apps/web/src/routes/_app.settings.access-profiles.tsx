import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/_app/settings/access-profiles')({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ location }) => {
    throw redirect({
      to: location.pathname.replace('/settings/access-profiles', '/admin/access-profiles'),
      search: location.search,
      replace: true,
    });
  },
});
