import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ErrorState } from '@/components/data/data-state';
export const Route = createRootRoute({
  component: Outlet,
  errorComponent: ({ reset }) => <ErrorState onRetry={reset} />,
});
