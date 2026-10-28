import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/_app/settings/integrations')({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ location }) => {
    throw redirect({
      to: location.pathname.replace('/settings/integrations', '/admin/integrations'),
      search: location.search,
      replace: true,
    });
  },
});
