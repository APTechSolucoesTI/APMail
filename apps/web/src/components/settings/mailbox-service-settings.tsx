import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { toast } from 'sonner';
import { can, type MailboxRole } from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, type MailboxConfiguration } from '@/lib/auth';
import { SchemaForm } from '@/components/forms/schema-form';
export function MailboxServiceSettings({ mailbox }: { mailbox: MailboxConfiguration }) {
  const tenant = useTenantId(),
    client = useQueryClient();
  const members = useQuery({
    queryKey: ['mailbox-members', tenant, mailbox.id],
    queryFn: () =>
      api<{ user_id: string; role: MailboxRole }[]>('/mailboxes/' + mailbox.id + '/members'),
  });
  const users = useQuery({
    queryKey: ['members', tenant],
    queryFn: () =>
      api<{ members: { user_id: string; full_name: string; status: string }[] }>('/members'),
  });
  const eligible = (users.data?.members ?? []).filter(
    (user) =>
      user.status === 'active' &&
      members.data?.some((member) => member.user_id === user.user_id && can(member.role, 'send')),
  );
  return (
    <section className="space-y-3 border-b pb-6">
      <div>
        <h2 className="text-lg font-semibold">Atendimento da caixa</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Caixas individuais têm um único dono. Caixas globais distribuem o atendimento entre a
          equipe.
        </p>
      </div>
      <SchemaForm
        key={JSON.stringify([mailbox.box_type, mailbox.owner_user_id, mailbox.queues_enabled])}
        schema={z
          .object({
            box_type: z.enum(['individual', 'global']),
            owner_user_id: z.union([z.uuid(), z.literal('')]).transform((value) => value || null),
            queues_enabled: z.boolean(),
          })
          .refine((value) => value.box_type !== 'individual' || !!value.owner_user_id, {
            path: ['owner_user_id'],
            message: 'Selecione o dono da caixa individual.',
          })}
        defaults={{
          box_type: mailbox.box_type ?? 'global',
          owner_user_id: mailbox.owner_user_id ?? '',
          queues_enabled: mailbox.queues_enabled ?? true,
        }}
        fields={[
          {
            name: 'box_type',
            label: 'Tipo de caixa',
            type: 'select',
            options: [
              { value: 'individual', label: 'Individual' },
              { value: 'global', label: 'Global' },
            ],
          },
          {
            name: 'owner_user_id',
            label: 'Dono da caixa individual',
            type: 'select',
            options: [
              { value: '', label: 'Sem dono (caixa global)' },
              ...(mailbox.owner_user_id &&
              !eligible.some((user) => user.user_id === mailbox.owner_user_id)
                ? [{ value: mailbox.owner_user_id, label: 'Dono atual' }]
                : []),
              ...eligible.map((user) => ({ value: user.user_id, label: user.full_name })),
            ],
            help:
              members.isError || users.isError
                ? 'Não foi possível carregar os membros. Recarregue para alterar o dono.'
                : 'Escolha um membro ativo com permissão de envio. O acesso não será concedido automaticamente.',
          },
          {
            name: 'queues_enabled',
            label: 'Utilizar filas',
            type: 'checkbox',
            help: 'Exibe filas e indicadores de atendimento nesta caixa. Iniciar e concluir continuam disponíveis com as filas ocultas.',
          },
        ]}
        submitLabel="Salvar atendimento da caixa"
        onSubmit={async (values) => {
          await api('/mailboxes/' + mailbox.id, {
            method: 'PATCH',
            body: {
              ...values,
              owner_user_id: values.box_type === 'global' ? null : values.owner_user_id,
            },
          });
          await client.invalidateQueries();
          toast.success('Atendimento da caixa atualizado.');
        }}
      />
    </section>
  );
}
