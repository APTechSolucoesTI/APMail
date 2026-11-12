import { createFileRoute, redirect } from '@tanstack/react-router';
import { ApiError } from '@/lib/api';
import { meQuery } from '@/lib/auth';
import { queryClient } from '@/lib/query-client';
import {
  readExternalLaunch,
  resolveExternalLaunch,
  saveExternalLaunch,
} from '@/lib/external-launch';

export const Route = createFileRoute('/abrir-externo')({
  beforeLoad: async ({ location }) => {
    const origin = window.location.origin;
    const destination = readExternalLaunch(location.searchStr, origin);
    if (!destination) throw redirect({ to: '/', replace: true });
    try {
      await queryClient.fetchQuery({ ...meQuery, staleTime: 0 });
      const href = await resolveExternalLaunch(destination, origin);
      throw redirect({ href, replace: true });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
      saveExternalLaunch(destination);
      throw redirect({ to: '/login', search: { external: true }, replace: true });
    }
  },
});
