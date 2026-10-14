import { useQuery, type QueryClient } from '@tanstack/react-query';
import { normalizeContactEmail, type ContactResolution } from '@apmail/shared';
import { useTenantId, useUserId } from './auth';
import { api } from './api';
export function useContactResolution(values: string[]) {
  const tenant = useTenantId(),
    user = useUserId();
  const emails = [
    ...new Set(values.map(normalizeContactEmail).filter((v): v is string => !!v)),
  ].sort();
  return useQuery({
    queryKey: ['contact-resolution', tenant, user, emails],
    enabled: !!tenant && !!user && !!emails.length,
    queryFn: ({ signal }) =>
      api<{ contacts: ContactResolution }>('/contacts/resolve', {
        method: 'POST',
        body: { emails },
        signal,
      }),
    staleTime: 30000,
  });
}
export async function invalidateContactResolution(client: QueryClient) {
  await Promise.all(
    [
      'contact-resolution',
      'contacts',
      'contact',
      'threads',
      'thread',
      'global-search',
      'address-suggestions',
    ].map((key) => client.invalidateQueries({ queryKey: [key] })),
  );
}
