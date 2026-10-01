import { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { listQuerySchema, ROLE_LABELS, type MailboxRole, type TenantRole } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { RoleBadge } from '@/components/common/status-badge';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
type Member = {
  user_id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: TenantRole;
  status: string;
};
export function MailboxMembersPanel({ mailboxId }: { mailboxId: string }) {
  const tenantId = useTenantId();
  const client = useQueryClient();
  const [query, setQuery] = useState(() => listQuerySchema.parse({}));
  const users = useQuery({
    queryKey: ['members', tenantId],
    queryFn: () => api<{ members: Member[] }>('/members'),
  });
  const access = useQuery({
    queryKey: ['mailbox-members', tenantId, mailboxId],
    queryFn: () =>
      api<{ user_id: string; role: MailboxRole }[]>('/mailboxes/' + mailboxId + '/members'),
  });
  const change = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string | null }) =>
      api('/mailboxes/' + mailboxId + '/members/' + userId, { method: 'PUT', body: { role } }),
    onSuccess: async () => {
      await client.invalidateQueries();
      toast.success('Acesso atualizado.');
    },
    onError: (e) => toast.error(e.message),
  });
  const rows = (users.data?.members ?? [])
    .filter((m) => m.status === 'active')
    .map((m) => ({
      ...m,
      id: m.user_id,
      implicit: m.role !== 'member',
      mailbox_role:
        m.role !== 'member'
          ? 'mailbox_admin'
          : (access.data?.find((a) => a.user_id === m.user_id)?.role ?? 'none'),
    }));
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Administradores da empresa acessam todas as caixas. Os demais usuários seguem o papel
        definido abaixo.
      </p>
      <ConfigurableTable
        listKey="mailbox-members"
        mode="client"
        data={rows}
        query={query}
        onQueryChange={setQuery}
        columns={[
          {
            id: 'full_name',
            header: 'Usuário',
            hideable: false,
            sortable: true,
            cell: (m) => (
              <span className="flex items-center gap-2">
                <UserAvatar name={m.full_name} src={m.avatar_url} size={24} />
                {m.full_name}
              </span>
            ),
          },
          { id: 'email', header: 'E-mail', sortable: true },
          {
            id: 'mailbox_role',
            header: 'Papel na caixa',
            cell: (m) =>
              m.implicit ? (
                <RoleBadge role="mailbox_admin" />
              ) : (
                <select
                  aria-label={'Papel de ' + m.full_name}
                  className="h-11 rounded-md border border-input bg-card px-2 text-sm sm:h-8"
                  value={m.mailbox_role}
                  disabled={change.isPending}
                  onChange={(e) =>
                    change.mutate({
                      userId: m.user_id,
                      role: e.target.value === 'none' ? null : e.target.value,
                    })
                  }
                >
                  {['none', 'viewer', 'editor', 'mailbox_admin'].map((role) => (
                    <option key={role} value={role}>
                      {role === 'none' ? 'Sem acesso' : ROLE_LABELS[role as MailboxRole]}
                    </option>
                  ))}
                </select>
              ),
          },
        ]}
        isLoading={users.isLoading || access.isLoading}
        error={users.error || access.error}
        onRetry={() => {
          void users.refetch();
          void access.refetch();
        }}
        rowActions={(m) =>
          !m.implicit && m.mailbox_role !== 'none' ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={change.isPending}
              onClick={() => change.mutate({ userId: m.user_id, role: null })}
            >
              Remover acesso
            </Button>
          ) : null
        }
      />
    </div>
  );
}
