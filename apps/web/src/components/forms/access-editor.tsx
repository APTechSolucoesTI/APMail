import { useTenantId } from '@/lib/auth';
import { useState } from 'react';
import { z } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { emailSchema, ROLE_LABELS, type MailboxRole, type TenantRole } from '@apmail/shared';
import { SchemaForm } from './schema-form';
import { api } from '@/lib/api';
import { meQuery, type Mailbox } from '@/lib/auth';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { toast } from 'sonner';
type Access = {
  tenant_role: TenantRole;
  mailbox_roles: { mailbox_id: string; role: MailboxRole | null }[];
};
export function AccessEditor({ userId, onDone }: { userId?: string; onDone: () => void }) {
  const q = useQuery({
    queryKey: ['access', useTenantId(), userId],
    queryFn: () => api<Access>('/members/' + userId + '/access'),
    enabled: !!userId,
  });
  if (userId && q.isLoading) return <LoadingState />;
  if (userId && !q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <AccessForm
      userId={userId}
      initial={q.data ?? { tenant_role: 'member', mailbox_roles: [] }}
      onDone={onDone}
    />
  );
}
function AccessForm({
  userId,
  initial,
  onDone,
}: {
  userId?: string;
  initial: Access;
  onDone: () => void;
}) {
  const client = useQueryClient();
  const me = useQuery(meQuery);
  const boxes = useQuery({
    queryKey: ['mailboxes', useTenantId()],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const [roles, setRoles] = useState(initial.mailbox_roles);
  const owner = me.data?.tenants.find((t) => t.id === me.data?.current_tenant_id)?.role === 'owner';
  return (
    <SchemaForm
      schema={z.object({
        tenant_role: z.enum(['owner', 'admin', 'member']),
        ...(userId ? {} : { email: emailSchema }),
      })}
      defaults={{ tenant_role: initial.tenant_role }}
      fields={[
        ...(userId ? [] : [{ name: 'email', label: 'E-mail', type: 'email' as const }]),
        {
          name: 'tenant_role',
          label: 'Papel na empresa',
          type: 'select',
          options: [
            { value: 'member', label: 'Membro' },
            ...(owner
              ? [
                  { value: 'admin', label: 'Administrador' },
                  ...(userId ? [{ value: 'owner', label: 'Proprietário' }] : []),
                ]
              : initial.tenant_role === 'admin'
                ? [{ value: 'admin', label: 'Administrador' }]
                : []),
          ],
        },
      ]}
      submitLabel={userId ? 'Salvar permissões' : 'Enviar convite'}
      onSubmit={async (b) => {
        const mailbox_roles = (boxes.data ?? []).map((box) => ({
          mailbox_id: box.id,
          role: roles.find((r) => r.mailbox_id === box.id)?.role ?? null,
        }));
        await api(userId ? '/members/' + userId + '/access' : '/invitations', {
          method: userId ? 'PUT' : 'POST',
          body: {
            ...b,
            mailbox_roles: userId ? mailbox_roles : mailbox_roles.filter((b) => b.role),
          },
        });
        await client.invalidateQueries();
        toast.success(userId ? 'Permissões atualizadas.' : 'Convite enviado.');
        onDone();
      }}
    >
      <p className="text-sm text-muted-foreground">
        Administradores e proprietários acessam todas as caixas como Admin da caixa.
      </p>
      <p className="text-xs text-muted-foreground">
        Somente leitura: ler. Editor: ler, responder, criar notas e assumir conversas. Admin da
        caixa: inclui organização, regras, atribuição e dashboard.
      </p>
      <div className="space-y-4">
        {boxes.data?.map((box) => (
          <fieldset key={box.id} className="rounded-md border p-3">
            <legend className="px-1 text-sm font-semibold">{box.name}</legend>
            <RadioGroup
              value={roles.find((r) => r.mailbox_id === box.id)?.role ?? 'none'}
              onValueChange={(v) =>
                setRoles((prev) => [
                  ...prev.filter((r) => r.mailbox_id !== box.id),
                  { mailbox_id: box.id, role: v === 'none' ? null : (v as MailboxRole) },
                ])
              }
              className="grid gap-2 sm:grid-cols-2"
            >
              {['none', 'viewer', 'editor', 'mailbox_admin'].map((role) => (
                <div key={role} className="flex min-h-11 items-center gap-2">
                  <RadioGroupItem id={box.id + '-' + role} value={role} />
                  <Label htmlFor={box.id + '-' + role}>
                    {role === 'none' ? 'Sem acesso' : ROLE_LABELS[role as MailboxRole]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </fieldset>
        ))}
      </div>
    </SchemaForm>
  );
}
