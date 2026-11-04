import { useMutation, useQuery, useQueryClient, useIsMutating } from '@tanstack/react-query';
import { toast } from 'sonner';
import { z } from 'zod';
import { api } from '@/lib/api';
import { meQuery, useTenantId } from '@/lib/auth';
const schema = z.object({
  domain_order: z.array(z.string()).default([]),
  mailbox_order: z.array(z.string()),
  folder_orders: z.record(z.string(), z.array(z.string())),
  favorite_folder_ids: z.array(z.string()),
});
export type MailNavigation = z.infer<typeof schema>;
type Action =
  | { type: 'domains'; ids: string[] }
  | { type: 'mailboxes'; ids: string[] }
  | { type: 'folders'; mailbox_id: string; parent_id: string | null; ids: string[] }
  | { type: 'favorite'; mailbox_id: string; folder_id: string; value: boolean };
const empty: MailNavigation = {
  domain_order: [],
  mailbox_order: [],
  folder_orders: {},
  favorite_folder_ids: [],
};
export function useMailNavigation() {
  const me = useQuery(meQuery).data,
    tenantContext = useTenantId(),
    tenant = tenantContext ?? me?.current_tenant_id;
  const client = useQueryClient(),
    key = ['mail-navigation', tenant, me?.user.id];
  const query = useQuery({
    queryKey: key,
    queryFn: async () => schema.parse(await api('/preferences/mail-navigation')),
    enabled: !!tenant && !!me?.user.id,
    staleTime: 60000,
    retry: false,
  });
  const busy = useIsMutating({ mutationKey: key }) > 0;
  const mutation = useMutation({
    mutationKey: key,
    scope: { id: key.join(':') },
    mutationFn: (action: Action) =>
      api<MailNavigation>('/preferences/mail-navigation', { method: 'PATCH', body: action }),
    onSuccess: (data) => {
      client.setQueryData(key, data);
    },
    onError: (error: Error) => toast.error(error.message),
  });
  return {
    config: query.data ?? empty,
    save: mutation.mutate,
    busy,
    isLoading: query.isPending,
    isError: query.isError,
    retry: query.refetch,
  };
}
