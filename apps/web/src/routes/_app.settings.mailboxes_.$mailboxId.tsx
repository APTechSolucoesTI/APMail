import { useTenantId } from '@/lib/auth';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { mailboxSchema } from '@apmail/shared';
import { api } from '@/lib/api';
import type { Mailbox } from '@/lib/auth';
import { requireAdmin } from '@/lib/settings';
import { PageHeader } from '@/components/layout/page-header';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SchemaForm } from '@/components/forms/schema-form';
import { connectionFields } from '@/components/forms/mailbox-wizard';
import { MailboxStatusBadge } from '@/components/common/status-badge';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { MailboxMembersPanel } from '@/components/settings/mailbox-members-panel';
import { toast } from 'sonner';
import { z } from 'zod';
export const Route = createFileRoute('/_app/settings/mailboxes_/$mailboxId')({
  beforeLoad: requireAdmin,
  component: MailboxSettings,
});
function MailboxSettings() {
  const { mailboxId } = Route.useParams();
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ['mailbox', useTenantId(), mailboxId],
    queryFn: () => api<Mailbox>('/mailboxes/' + mailboxId),
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
          <TabsTrigger value="send">Envio</TabsTrigger>
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
        <TabsContent value="members">
          <MailboxMembersPanel mailboxId={mailboxId} />
        </TabsContent>
        <TabsContent value="send" className="max-w-2xl rounded-lg border bg-card p-4">
          <SchemaForm
            schema={mailboxSchema.pick({ from_name_template: true, append_sent_copy: true })}
            defaults={q.data}
            fields={[
              {
                name: 'from_name_template',
                label: 'Modelo do nome do remetente',
                type: 'select',
                options: [
                  '{mailbox_name}',
                  '{user_name} | {mailbox_name}',
                  '{user_name} - {tenant_name}',
                ].map((value) => ({ value, label: value })),
              },
              {
                name: 'append_sent_copy',
                label: 'Salvar cópia em Enviados',
                type: 'checkbox',
                help: 'Desative se o provedor salva automaticamente e aparecem duplicados.',
              },
            ]}
            onSubmit={async (body) => {
              await api('/mailboxes/' + mailboxId, { method: 'PATCH', body });
              await client.invalidateQueries({ queryKey: ['mailbox'] });
              toast.success('Configuração de envio atualizada.');
            }}
          />
        </TabsContent>
      </Tabs>
    </>
  );
}
