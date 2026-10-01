import { createRootRoute, Outlet } from '@tanstack/react-router';
import { ErrorState, NoPermissionState } from '@/components/data/data-state';
import { ApiError } from '@/lib/api';
export const Route = createRootRoute({
  component: Outlet,
  errorComponent: ({ reset, error }) =>
    error instanceof ApiError && error.status === 403 ? (
      <NoPermissionState />
    ) : (
      <ErrorState onRetry={reset} />
    ),
});
