import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { mailboxSchema, type MailboxRole } from '@apmail/shared';
import { api } from '@/lib/api';
import type { Mailbox } from '@/lib/auth';
import { requireAdmin } from '@/lib/settings';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SchemaForm } from '@/components/forms/schema-form';
import { connectionFields } from '@/components/forms/mailbox-wizard';
import { MailboxStatusBadge } from '@/components/common/status-badge';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { z } from 'zod';
export const Route = createFileRoute('/_app/settings/mailboxes_/$mailboxId')({
  beforeLoad: requireAdmin,
  component: MailboxSettings,
});
function MailboxSettings() {
  const { mailboxId } = Route.useParams();
  const client = useQueryClient();
  const changeAccess = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string | null }) =>
      api('/mailboxes/' + mailboxId + '/members/' + userId, { method: 'PUT', body: { role } }),
    onSuccess: async () => {
      await client.invalidateQueries();
      toast.success('Acesso atualizado.');
    },
    onError: (e) => toast.error(e.message),
  });
  const q = useQuery({
    queryKey: ['mailbox', mailboxId],
    queryFn: () => api<Mailbox>('/mailboxes/' + mailboxId),
  });
  const members = useQuery({
    queryKey: ['mailbox-members', mailboxId],
    queryFn: () =>
      api<{ user_id: string; full_name: string; email: string; role: MailboxRole }[]>(
        '/mailboxes/' + mailboxId + '/members',
      ),
  });
  const directory = useQuery({
    queryKey: ['directory'],
    queryFn: () => api<{ id: string; full_name: string; email: string }[]>('/members/directory'),
  });
  if (q.isLoading) return <LoadingState />;
  if (!q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <>
      <PageHeader title={q.data.name} description={q.data.email_address} />
      <MailboxStatusBadge status={q.data.status} />
      <Tabs defaultValue="connection" className="mt-4">
        <TabsList>
          <TabsTrigger value="connection">Conexão</TabsTrigger>
          <TabsTrigger value="members">Membros</TabsTrigger>
        </TabsList>
        <TabsContent value="connection" className="max-w-2xl rounded-lg border bg-card p-4">
          <SchemaForm
            cancelLabel="Cancelar"
            schema={mailboxSchema
              .partial()
              .omit({ members: true, sync_days: true })
              .extend({
                password: z.preprocess(
                  (v) => (v === '' ? undefined : v),
                  z.string().min(1).optional(),
                ),
              })}
            defaults={{ ...q.data }}
            fields={[
              { name: 'name', label: 'Nome da caixa' },
              ...connectionFields.map((f) =>
                f.name === 'password'
                  ? { ...f, label: 'Alterar senha (preencha somente para trocar)' }
                  : f,
              ),
              { name: 'from_name_template', label: 'Modelo do nome do remetente' },
              { name: 'append_sent_copy', label: 'Salvar cópia em Enviados', type: 'checkbox' },
            ]}
            onSubmit={async (b) => {
              const body = { ...b };
              if (!body.password) delete body.password;
              await api('/mailboxes/' + mailboxId, { method: 'PATCH', body });
              await client.invalidateQueries();
              toast.success('Caixa atualizada.');
            }}
          />
        </TabsContent>
        <TabsContent value="members" className="space-y-4 rounded-lg border bg-card p-4">
          <p className="text-sm text-muted-foreground">
            Administradores da empresa acessam todas as caixas.
          </p>
          {directory.data?.map((u) => (
            <div
              key={u.id}
              className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"
            >
              <Label htmlFor={'role-' + u.id} className="break-all">
                {u.full_name}
                <span className="block text-xs font-normal text-muted-foreground">{u.email}</span>
              </Label>
              <select
                id={'role-' + u.id}
                disabled={changeAccess.isPending}
                className="h-11 rounded-md border border-input bg-card px-3 text-sm"
                value={members.data?.find((m) => m.user_id === u.id)?.role ?? 'none'}
                onChange={(e) =>
                  changeAccess.mutate({
                    userId: u.id,
                    role: e.target.value === 'none' ? null : e.target.value,
                  })
                }
              >
                {[
                  ['none', 'Sem acesso'],
                  ['viewer', 'Somente leitura'],
                  ['editor', 'Editor'],
                  ['mailbox_admin', 'Admin da caixa'],
                ].map(([value, label]) => (
                  <option value={value} key={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </TabsContent>
      </Tabs>
    </>
  );
}
