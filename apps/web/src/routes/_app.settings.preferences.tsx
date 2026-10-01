import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { preferencesSchema } from '@apmail/shared';
import { PageHeader } from '@/components/layout/page-header';
import { SchemaForm } from '@/components/forms/schema-form';
import { meQuery } from '@/lib/auth';
import { api } from '@/lib/api';
import { toast } from 'sonner';
export const Route = createFileRoute('/_app/settings/preferences')({ component: Preferences });
function Preferences() {
  const q = useQuery(meQuery);
  const client = useQueryClient();
  if (!q.data) return null;
  return (
    <>
      <PageHeader
        title="Preferências"
        description="Escolha como trabalhar e receber atualizações."
      />
      <section className="max-w-2xl rounded-lg border bg-card p-4">
        <SchemaForm
          cancelLabel="Cancelar"
          schema={preferencesSchema}
          defaults={{ ...q.data.preferences }}
          fields={[
            {
              name: 'theme',
              label: 'Tema',
              type: 'select',
              options: [
                { value: 'system', label: 'Seguir o sistema' },
                { value: 'light', label: 'Claro' },
                { value: 'dark', label: 'Escuro' },
              ],
            },
            {
              name: 'density',
              label: 'Densidade',
              type: 'select',
              options: [
                { value: 'comfortable', label: 'Confortável' },
                { value: 'compact', label: 'Compacta' },
              ],
            },
            {
              name: 'timezone',
              label: 'Fuso horário',
              type: 'timezone',
              help: 'Exemplo: America/Sao_Paulo.',
            },
            ...[
              'notify_mentions',
              'notify_assignments',
              'notify_chat',
              'desktop_notifications',
              'load_remote_images',
            ].map((name, i) => ({
              name,
              label: [
                'Notificar menções',
                'Notificar atribuições',
                'Notificar mensagens do chat',
                'Notificações do navegador',
                'Carregar imagens externas automaticamente',
              ][i]!,
              type: 'checkbox' as const,
              help:
                name === 'load_remote_images'
                  ? 'Imagens externas podem informar ao remetente que a mensagem foi aberta.'
                  : undefined,
            })),
          ]}
          onSubmit={async (b) => {
            if (b.desktop_notifications) {
              if (!('Notification' in window))
                throw new Error('Este navegador não oferece notificações.');
              if ((await Notification.requestPermission()) !== 'granted')
                throw new Error('Permita notificações no navegador para ativar esta opção.');
            }
            await api('/preferences', { method: 'PUT', body: b });
            await client.invalidateQueries({ queryKey: ['me'] });
            toast.success('Preferências salvas.');
          }}
        />
      </section>
    </>
  );
}
