import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Building2, Mail, HardDrive } from 'lucide-react';
import { z } from 'zod';
import {
  companyDetailsSchema,
  tenantSettingsSchema,
  timezoneSchema,
  type CompanyDetails,
} from '@apmail/shared';
import { useAccess, useTenantId, type Mailbox } from '@/lib/auth';
import { api } from '@/lib/api';
import { PageHeader } from '@/components/layout/page-header';
import { CompanyForm } from '@/components/forms/company-fields';
import { SchemaForm, type FormField } from '@/components/forms/schema-form';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { TenantStorage } from '@/components/storage/storage-quotas';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { toast } from 'sonner';

type Company = {
  name: string;
  timezone: string;
  settings: Record<string, unknown>;
  company_details: CompanyDetails;
};
type SettingsSection = {
  title: string;
  description: string;
  submitLabel: string;
  schema: z.ZodObject;
  fields: FormField[];
};

export function CompanySettings() {
  const [tab, setTab] = useState('registration');
  const tenantId = useTenantId(),
    client = useQueryClient(),
    canReadMailboxes = useAccess('mail');
  const q = useQuery({ queryKey: ['tenant', tenantId], queryFn: () => api<Company>('/tenant') });
  const boxes = useQuery({
    queryKey: ['mailboxes', tenantId],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
    enabled: canReadMailboxes,
  });
  const sections: SettingsSection[] = [
    {
      title: 'Agenda de contatos',
      description:
        'Escolha a visibilidade dos novos contatos. Os contatos existentes mantêm sua configuração.',
      submitLabel: 'Salvar contatos',
      schema: tenantSettingsSchema.pick({ contact_mode: true }),
      fields: [
        {
          name: 'settings.contact_mode',
          label: 'Modo de novos contatos',
          type: 'select',
          options: [
            { value: 'tenant', label: 'Global — compartilhados com a empresa' },
            { value: 'personal', label: 'Individual — privados por usuário' },
          ],
        },
      ],
    },
    {
      title: 'Envio e segurança',
      description: 'Defina a caixa usada nos convites e os limites de envio da empresa.',
      submitLabel: 'Salvar envio',
      schema: tenantSettingsSchema.pick({
        max_attachment_mb: true,
        default_invitation_mailbox_id: true,
        allow_external_auto_forward: true,
      }),
      fields: [
        {
          name: 'settings.default_invitation_mailbox_id',
          label: 'Caixa padrão para convites',
          type: 'select',
          options: [
            { value: '', label: 'Primeira caixa ativa' },
            ...(q.data?.settings.default_invitation_mailbox_id &&
            !boxes.data?.some((box) => box.id === q.data?.settings.default_invitation_mailbox_id)
              ? [
                  {
                    value: String(q.data.settings.default_invitation_mailbox_id),
                    label: 'Caixa padrão configurada',
                  },
                ]
              : []),
            ...(boxes.data ?? [])
              .filter((box) => box.status === 'active')
              .map((box) => ({ value: box.id, label: `${box.name} (${box.email_address})` })),
          ],
          help: boxes.isError
            ? 'Não foi possível carregar as caixas. A seleção atual será preservada.'
            : undefined,
        },
        { name: 'settings.max_attachment_mb', label: 'Limite por anexo (MB)', type: 'number' },
        {
          name: 'settings.allow_external_auto_forward',
          label: 'Encaminhamento automático externo',
          type: 'checkbox',
          help: 'Permitir que regras encaminhem mensagens para endereços externos.',
        },
      ],
    },
    {
      title: 'Atendimento e recebimento',
      description: 'Configure o prazo de resposta e o período de importação de novas caixas.',
      submitLabel: 'Salvar atendimento',
      schema: tenantSettingsSchema.pick({ sla_first_response_hours: true }).extend({
        default_sync_days: z.coerce
          .number()
          .pipe(z.union([z.literal(30), z.literal(90), z.literal(180), z.literal(365)]))
          .optional(),
      }),
      fields: [
        {
          name: 'settings.sla_first_response_hours',
          label: 'Prazo da primeira resposta (horas)',
          type: 'number',
        },
        {
          name: 'settings.default_sync_days',
          label: 'Período de importação inicial',
          type: 'select',
          options: [30, 90, 180, 365].map((days) => ({
            value: String(days),
            label: `${days} dias`,
          })),
        },
      ],
    },
  ];
  async function save(values: Record<string, unknown>, message: string) {
    await api('/tenant', { method: 'PATCH', body: values });
    await client.invalidateQueries({ queryKey: ['tenant', tenantId] });
    toast.success(message);
  }
  return (
    <>
      <PageHeader
        title="Empresa"
        description="Gerencie o cadastro e os padrões compartilhados pela equipe."
      />
      {q.isPending ? (
        <LoadingState />
      ) : q.isError ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        <Tabs value={tab} onValueChange={setTab} className="max-w-4xl gap-5">
          <TabsList
            aria-label="Configurações da empresa"
            className="grid h-auto! w-full grid-cols-3 sm:inline-flex sm:w-fit"
          >
            <TabsTrigger
              value="registration"
              className="min-h-11 min-w-0 whitespace-normal sm:min-h-8"
            >
              <Building2 aria-hidden className="hidden sm:block" />
              Cadastro
            </TabsTrigger>
            <TabsTrigger
              value="operations"
              className="min-h-11 min-w-0 whitespace-normal sm:min-h-8"
            >
              <Mail aria-hidden className="hidden sm:block" />
              E-mail e contatos
            </TabsTrigger>
            <TabsTrigger value="storage" className="min-h-11 min-w-0 whitespace-normal sm:min-h-8">
              <HardDrive aria-hidden className="hidden sm:block" />
              Armazenamento
            </TabsTrigger>
          </TabsList>
          <TabsContent value="registration" forceMount hidden={tab !== 'registration'}>
            <section className="rounded-lg border bg-card p-4 sm:p-5">
              <div className="mb-5">
                <h2 className="text-lg font-semibold">Cadastro da empresa</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Identificação, endereço e canais de contato da organização.
                </p>
              </div>
              <CompanyForm
                key={tenantId}
                schema={z.object({
                  name: z.string().trim().min(2).max(120),
                  timezone: timezoneSchema,
                  company_details: companyDetailsSchema,
                })}
                defaults={{
                  name: q.data.name,
                  timezone: q.data.timezone,
                  company_details: q.data.company_details ?? {},
                }}
                fields={[
                  { name: 'name', label: 'Nome da empresa' },
                  { name: 'timezone', label: 'Fuso horário', type: 'timezone' },
                ]}
                lookupPath="/tenant/company-lookup/"
                onSubmit={(values) => save(values, 'Cadastro da empresa atualizado.')}
              />
            </section>
          </TabsContent>
          <TabsContent value="operations" forceMount hidden={tab !== 'operations'}>
            <div className="divide-y rounded-lg border bg-card px-4 sm:px-5">
              {sections.map((section) => (
                <section
                  key={section.title}
                  className="grid gap-4 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:gap-8"
                >
                  <div>
                    <h2 className="text-base font-semibold">{section.title}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
                  </div>
                  <SchemaForm
                    schema={z.object({ settings: section.schema })}
                    defaults={{ settings: { contact_mode: 'tenant', ...q.data.settings } }}
                    fields={section.fields}
                    submitLabel={section.submitLabel}
                    onSubmit={(values) => save(values, 'Padrões da empresa atualizados.')}
                  />
                </section>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="storage">
            <section className="space-y-4">
              <div>
                <h2 className="text-lg font-semibold">Armazenamento</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Acompanhe o uso de espaço e os limites da empresa.
                </p>
              </div>
              {tenantId && <TenantStorage tenantId={tenantId} />}
            </section>
          </TabsContent>
        </Tabs>
      )}
    </>
  );
}
