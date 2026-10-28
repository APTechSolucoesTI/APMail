import { useQuery, useQueryClient } from '@tanstack/react-query';
import { preferencesSchema } from '@apmail/shared';
import { PageHeader } from '@/components/layout/page-header';
import { SchemaForm, type FormField } from '@/components/forms/schema-form';
import { meQuery } from '@/lib/auth';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { InvitationEmailSettings } from '@/components/calendar/invitation-email-preferences';
import { TwoFactorSettings } from '@/components/settings/two-factor-settings';
import { CompositionSettings } from '@/components/settings/composition-settings';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { LoadingState, ErrorState } from '@/components/data/data-state';

const groups: { id: string; title: string; description: string; fields: FormField[] }[] = [
  {
    id: 'general',
    title: 'Geral',
    description: 'Personalize a aparência e o horário utilizado no APMail.',
    fields: [
      {
        name: 'theme',
        label: 'Tema',
        type: 'select',
        options: [
          { value: 'light', label: 'Claro' },
          { value: 'dark', label: 'Escuro' },
        ],
      },
      {
        name: 'timezone',
        label: 'Fuso horário',
        type: 'timezone',
        help: 'Usado para exibir horários e configurar compromissos e agendamentos.',
      },
    ],
  },
  {
    id: 'email',
    title: 'E-mail',
    description: 'Defina como organizar suas mensagens e trabalhar com confirmações de leitura.',
    fields: [
      {
        name: 'mail_group_by_domain',
        label: 'Agrupar caixas por domínio',
        type: 'checkbox',
        help: 'Organizar suas caixas de e-mail em grupos por domínio.',
      },
      {
        name: 'mail_summary_enabled',
        label: 'Deseja utilizar o Resumo das caixas de entrada?',
        type: 'checkbox',
        help: 'Reunir mensagens e filas das caixas às quais você tem acesso em uma visão unificada.',
      },
      {
        name: 'mail_page_size',
        label: 'E-mails por página',
        type: 'select',
        options: [10, 25, 50, 100].map((size) => ({ value: String(size), label: String(size) })),
      },
      {
        name: 'request_read_receipt',
        label: 'Solicitar confirmação de leitura por padrão',
        type: 'checkbox',
        help: 'Ativar automaticamente a solicitação de confirmação de leitura ao escrever novos e-mails.',
      },
      {
        name: 'load_remote_images',
        label: 'Carregar imagens externas automaticamente',
        type: 'checkbox',
        help: 'Imagens externas podem informar ao remetente que a mensagem foi aberta.',
      },
    ],
  },
  {
    id: 'notifications',
    title: 'Notificações',
    description: 'Escolha quais atualizações você quer receber.',
    fields: [
      {
        name: 'notify_mentions',
        label: 'Notificar menções',
        type: 'checkbox',
        help: 'Avisar quando alguém mencionar você.',
      },
      {
        name: 'notify_assignments',
        label: 'Notificar atribuições',
        type: 'checkbox',
        help: 'Avisar quando uma conversa for atribuída a você.',
      },
      {
        name: 'notify_chat',
        label: 'Notificar mensagens do chat',
        type: 'checkbox',
        help: 'Receber avisos de novas mensagens internas.',
      },
      {
        name: 'desktop_notifications',
        label: 'Notificações do navegador',
        type: 'checkbox',
        help: 'Exibir notificações fora da janela do APMail, com sua permissão.',
      },
    ],
  },
];
export function PreferencesSettings() {
  const q = useQuery(meQuery);
  const client = useQueryClient();
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <>
      <PageHeader
        title="Preferências"
        description="Personalize sua experiência, suas notificações e a segurança da conta."
      />
      <Tabs defaultValue="general" className="max-w-3xl gap-4">
        <div className="max-w-full overflow-x-auto pb-1">
          <TabsList aria-label="Categorias de preferências" className="h-11 sm:h-9">
            {groups.map((group) => (
              <TabsTrigger key={group.id} value={group.id}>
                {group.title}
              </TabsTrigger>
            ))}
            <TabsTrigger value="invitations">Convites</TabsTrigger>
            {!q.data.platform_admin && <TabsTrigger value="composition">Composição</TabsTrigger>}
            <TabsTrigger value="two-factor">2FA</TabsTrigger>
          </TabsList>
        </div>
        {groups.map((group) => (
          <TabsContent key={group.id} value={group.id}>
            <section
              aria-labelledby={'preferences-' + group.id}
              className="rounded-lg border bg-card p-4 sm:p-5"
            >
              <h2 id={'preferences-' + group.id} className="text-base font-semibold">
                {group.title}
              </h2>
              <p className="mt-1 mb-5 text-sm text-muted-foreground">{group.description}</p>
              <SchemaForm
                key={group.id + '-' + q.data.preferences.theme + '-' + q.data.preferences.timezone}
                cancelLabel="Cancelar"
                schema={preferencesSchema}
                defaults={Object.fromEntries(
                  group.fields.map((field) => [
                    field.name,
                    q.data.preferences[field.name as keyof typeof q.data.preferences] ??
                      (field.name === 'mail_page_size' ? 10 : false),
                  ]),
                )}
                fields={group.fields}
                onSubmit={async (b) => {
                  if (b.desktop_notifications) {
                    if (!('Notification' in window))
                      throw new Error('Este navegador não oferece notificações.');
                    if ((await Notification.requestPermission()) !== 'granted')
                      throw new Error('Permita notificações no navegador para ativar esta opção.');
                  }
                  await api('/preferences', { method: 'PUT', body: { ...b, density: 'compact' } });
                  await client.invalidateQueries({ queryKey: ['me'] });
                  toast.success('Preferências salvas.', { id: 'preferences-saved' });
                }}
              />
            </section>
          </TabsContent>
        ))}
        <TabsContent value="invitations">
          <InvitationEmailSettings className="max-w-none" />
        </TabsContent>
        <TabsContent value="composition">
          <CompositionSettings />
        </TabsContent>
        <TabsContent value="two-factor">
          <TwoFactorSettings />
        </TabsContent>
      </Tabs>
    </>
  );
}
