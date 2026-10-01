import { useTenantId } from '@/lib/auth';
import { useState } from 'react';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listQuerySchema, type TenantRole } from '@apmail/shared';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { RoleBadge, StatusBadge } from '@/components/common/status-badge';
import { UserAvatar } from '@/components/common/user-avatar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { AccessEditor } from '@/components/forms/access-editor';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { api } from '@/lib/api';
import { requireAdmin } from '@/lib/settings';
import { Pencil, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { meQuery } from '@/lib/auth';
type Member = {
  user_id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: TenantRole;
  status: 'active' | 'disabled';
  mailbox_count: number;
};
type Invite = { id: string; email: string; tenant_role: TenantRole };
export const Route = createFileRoute('/_app/settings/users')({
  beforeLoad: requireAdmin,
  validateSearch: listQuerySchema,
  component: Users,
});
function Users() {
  const me = useQuery(meQuery);
  const owner = me.data?.tenants.find((t) => t.id === me.data?.current_tenant_id)?.role === 'owner';
  const query = Route.useSearch();
  const navigate = useNavigate();
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ['members', useTenantId()],
    queryFn: () => api<{ members: Member[]; invitations: Invite[] }>('/members'),
  });
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [change, setChange] = useState<Member | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const rows = (q.data?.members ?? []).map((m) => ({ ...m, id: m.user_id }));
  const refresh = async () => {
    await client.invalidateQueries();
  };
  return (
    <>
      <PageHeader
        title="Equipe e acessos"
        description="Convide pessoas e defina suas permissões."
        actions={
          <Button onClick={() => setEditing(null)}>
            <UserPlus />
            Convidar usuário
          </Button>
        }
      />
      <ConfigurableTable
        listKey="tenant-users"
        mode="client"
        data={rows}
        query={query}
        onQueryChange={(search) => void navigate({ to: '/settings/users', search })}
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        columns={[
          {
            id: 'full_name',
            header: 'Nome',
            sortable: true,
            hideable: false,
            cell: (m) => (
              <span className="flex items-center gap-2">
                <UserAvatar name={m.full_name} src={m.avatar_url} size={24} />
                {m.full_name}
              </span>
            ),
          },
          { id: 'email', header: 'E-mail', sortable: true },
          { id: 'role', header: 'Papel', cell: (m) => <RoleBadge role={m.role} /> },
          {
            id: 'status',
            header: 'Status',
            cell: (m) => (
              <StatusBadge
                label={m.status === 'active' ? 'Ativo' : 'Desativado'}
                variant={m.status === 'active' ? 'success' : 'neutral'}
              />
            ),
          },
          { id: 'mailbox_count', header: 'Caixas', align: 'right' },
        ]}
        rowActions={(m) =>
          m.role !== 'owner' || owner ? (
            <>
              <Button
                size="icon"
                variant="ghost"
                aria-label={'Editar permissões de ' + m.full_name}
                onClick={() => setEditing(m.user_id)}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={m.user_id === me.data?.user.id}
                title={
                  m.user_id === me.data?.user.id
                    ? 'Você não pode desativar sua própria conta.'
                    : undefined
                }
                onClick={() => setChange(m)}
              >
                {m.status === 'active' ? 'Desativar' : 'Reativar'}
              </Button>
            </>
          ) : null
        }
      />
      {!!q.data?.invitations.length && (
        <section className="mt-6 rounded-lg border bg-card p-4">
          <h2 className="mb-4 text-xl font-semibold">Convites pendentes</h2>
          <ul className="space-y-3">
            {q.data.invitations.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"
              >
                <div className="min-w-0">
                  <p className="break-all text-sm">{i.email}</p>
                  <StatusBadge label="Convidado" variant="info" />
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={sending === i.id}
                    onClick={async () => {
                      setSending(i.id);
                      try {
                        await api('/invitations/' + i.id + '/resend', { method: 'POST' });
                        toast.success('Convite reenviado.');
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : 'Falha ao reenviar.');
                      } finally {
                        setSending(null);
                      }
                    }}
                  >
                    Reenviar
                  </Button>
                  <ConfirmDialog
                    trigger={
                      <Button variant="ghost" size="sm">
                        Revogar
                      </Button>
                    }
                    title="Revogar convite?"
                    description="O link enviado deixará de permitir a entrada na empresa."
                    onConfirm={async () => {
                      await api('/invitations/' + i.id, { method: 'DELETE' });
                      await refresh();
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Dialog
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar permissões' : 'Convidar usuário'}</DialogTitle>
            <DialogDescription>
              Escolha o papel na empresa e o acesso a cada caixa.
            </DialogDescription>
          </DialogHeader>
          {editing !== undefined && (
            <AccessEditor
              key={editing ?? 'new'}
              userId={editing ?? undefined}
              onDone={() => setEditing(undefined)}
            />
          )}
        </DialogContent>
      </Dialog>
      {change && (
        <ConfirmDialog
          open
          onOpenChange={(open) => {
            if (!open) setChange(null);
          }}
          title={change.status === 'active' ? 'Desativar usuário?' : 'Reativar usuário?'}
          description={
            change.status === 'active'
              ? 'O acesso à empresa será bloqueado imediatamente.'
              : 'O usuário poderá acessar novamente a empresa.'
          }
          onConfirm={async () => {
            await api('/members/' + change.user_id + '/status', {
              method: 'PUT',
              body: { status: change.status === 'active' ? 'disabled' : 'active' },
            });
            await refresh();
            setChange(null);
          }}
        />
      )}
    </>
  );
}
