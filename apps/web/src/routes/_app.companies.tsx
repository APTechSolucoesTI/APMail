import { createFileRoute, redirect } from '@tanstack/react-router';
export const Route = createFileRoute('/_app/companies')({
  beforeLoad: () => {
    throw redirect({ to: '/contacts' });
  },
});
