import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import type { Address } from '@apmail/shared';
import { useTenantId, useUserId } from '@/lib/auth';
import { api } from '@/lib/api';
import { ContactAssociationDialog } from './contact-association-dialog';
const subscribe = (callback: () => void) => {
  const observer = new MutationObserver(callback);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-state'],
  });
  return () => observer.disconnect();
};
const occupied = () =>
  !!document.querySelector(
    '[role="dialog"][data-state="open"]:not([data-contact-association]),[role="alertdialog"][data-state="open"]',
  );
export function PostSendContacts() {
  const tenant = useTenantId(),
    user = useUserId(),
    client = useQueryClient();
  const hasModal = useSyncExternalStore(subscribe, occupied, () => false);
  const queryKey = ['contact-prompts', tenant, user];
  const prompt = useQuery({
    queryKey,
    enabled: !!tenant && !!user && !hasModal,
    queryFn: () =>
      api<{ id: string; addresses: Address[] } | null>('/outbox/contact-prompts/next', {
        method: 'POST',
        body: {},
      }),
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: false,
    refetchInterval: (query) => (query.state.data ? false : 5000),
  });
  if (!prompt.data || hasModal) return null;
  // Delay display while another modal/composer is open; delivery is already complete.
  return (
    <ContactAssociationDialog
      key={prompt.data.id}
      addresses={prompt.data.addresses}
      afterSend
      onClose={() => {
        client.setQueryData(queryKey, null);
        void prompt.refetch();
      }}
    />
  );
}
