import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/_app/security/antivirus')({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ location }) => {
    throw redirect({
      to: location.pathname.replace('/security/antivirus', '/admin/security/antivirus'),
      search: location.search,
      replace: true,
    });
  },
});
