import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { tenantSettingsSchema, timezoneSchema } from '@apmail/shared';
import { PageHeader } from '@/components/layout/page-header';
import { SchemaForm } from '@/components/forms/schema-form';
import { api } from '@/lib/api';
import { requireAdmin } from '@/lib/settings';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { toast } from 'sonner';
export const Route = createFileRoute('/_app/settings/tenant')({
  beforeLoad: requireAdmin,
  component: Tenant,
});
function Tenant() {
  const client = useQueryClient();
  const q = useQuery({
    queryKey: ['tenant'],
    queryFn: () =>
      api<{ name: string; timezone: string; settings: Record<string, unknown> }>('/tenant'),
  });
  return (
    <>
      <PageHeader title="Empresa" description="Defina os padrões operacionais da equipe." />
      {q.isLoading ? (
        <LoadingState />
      ) : !q.data ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <section className="max-w-2xl rounded-lg border bg-card p-4">
          <SchemaForm
            cancelLabel="Cancelar"
            schema={z.object({
              name: z.string().min(2).max(120),
              timezone: timezoneSchema,
              settings: tenantSettingsSchema,
            })}
            defaults={{ ...q.data }}
            fields={[
              { name: 'name', label: 'Nome da empresa' },
              { name: 'timezone', label: 'Fuso horário' },
              {
                name: 'settings.max_attachment_mb',
                label: 'Limite por anexo (MB)',
                type: 'number',
              },
              {
                name: 'settings.sla_first_response_hours',
                label: 'SLA da primeira resposta (horas)',
                type: 'number',
              },
              {
                name: 'settings.default_sync_days',
                label: 'Dias de importação inicial',
                type: 'number',
              },
              {
                name: 'settings.allow_external_auto_forward',
                label: 'Permitir encaminhamento automático externo',
                type: 'checkbox',
              },
            ]}
            onSubmit={async (b) => {
              await api('/tenant', { method: 'PATCH', body: b });
              await client.invalidateQueries();
              toast.success('Empresa atualizada.');
            }}
          />
        </section>
      )}
    </>
  );
}
