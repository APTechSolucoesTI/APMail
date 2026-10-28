import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/_app/settings/mailboxes')({
  validateSearch: (search: Record<string, unknown>) => search,
  beforeLoad: ({ location }) => {
    throw redirect({
      to: location.pathname.replace('/settings/mailboxes', '/admin/mailboxes'),
      search: location.search,
      replace: true,
    });
  },
});
