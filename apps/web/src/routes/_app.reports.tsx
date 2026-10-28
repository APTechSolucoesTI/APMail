import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/_app/reports')({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ location }) => {
    throw redirect({
      to: location.pathname.replace('/reports', '/admin/reports'),
      search: location.search,
      replace: true,
    });
  },
});
