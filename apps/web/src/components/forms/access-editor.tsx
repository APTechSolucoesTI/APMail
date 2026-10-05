import { isTenantAdmin } from '@apmail/shared';
import { SUPERVISOR_CAPABILITIES, CAPABILITY_LABELS } from '@apmail/shared';
import { Checkbox } from '@/components/ui/checkbox';
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
import { FolderAccessPicker, type FolderAccess } from './folder-access-picker';
type Access = {
  tenant_role: TenantRole;
  capabilities?: string[];
  mailbox_roles: ({ mailbox_id: string; role: MailboxRole | null } & FolderAccess)[];
};
export function AccessEditor({
  userId,
  onDone,
  platformTenantId,
}: {
  userId?: string;
  onDone: () => void;
  platformTenantId?: string;
}) {
  const tenantId = useTenantId();
  const q = useQuery({
    queryKey: ['access', platformTenantId ?? tenantId, userId],
    queryFn: () =>
      api<Access>(
        platformTenantId
          ? '/superadmin/users/' + userId + '/access?tenant_id=' + platformTenantId
          : '/members/' + userId + '/access',
      ),
    enabled: !!userId,
  });
  if (userId && q.isLoading) return <LoadingState />;
  if (userId && !q.data) return <ErrorState onRetry={() => void q.refetch()} />;
  return (
    <AccessForm
      userId={userId}
      platformTenantId={platformTenantId}
      initial={q.data ?? { tenant_role: 'member', mailbox_roles: [] }}
      onDone={onDone}
    />
  );
}
function AccessForm({
  userId,
  initial,
  onDone,
  platformTenantId,
}: {
  userId?: string;
  initial: Access;
  onDone: () => void;
  platformTenantId?: string;
}) {
  const client = useQueryClient();
  const tenantId = useTenantId();
  const me = useQuery(meQuery);
  const boxes = useQuery({
    queryKey: ['mailboxes', platformTenantId ?? tenantId, !!platformTenantId],
    queryFn: () =>
      api<Mailbox[]>(
        platformTenantId ? '/superadmin/tenants/' + platformTenantId + '/mailboxes' : '/mailboxes',
      ),
  });
  const [roles, setRoles] = useState(initial.mailbox_roles);
  const [capabilities, setCapabilities] = useState(initial.capabilities ?? []);
  const owner =
    !!platformTenantId ||
    me.data?.tenants.find((t) => t.id === me.data?.current_tenant_id)?.role === 'owner';
  const tenantSettings = useQuery({
    queryKey: ['tenant', useTenantId()],
    queryFn: () => api<{ settings: { default_invitation_mailbox_id?: string } }>('/tenant'),
    enabled: !userId,
  });
  if (boxes.isLoading || (!userId && tenantSettings.isLoading)) return <LoadingState />;
  return (
    <SchemaForm
      schema={z.object({
        tenant_role: z.enum(['owner', 'admin', 'member', 'supervisor']),
        ...(userId ? {} : { email: emailSchema, sender_mailbox_id: z.uuid() }),
      })}
      defaults={{
        tenant_role: initial.tenant_role,
        sender_mailbox_id:
          tenantSettings.data?.settings.default_invitation_mailbox_id ??
          boxes.data?.find((b) => b.status === 'active')?.id,
      }}
      fields={[
        ...(userId
          ? []
          : [
              { name: 'email', label: 'E-mail', type: 'email' as const },
              {
                name: 'sender_mailbox_id',
                label: 'Enviar convite pela caixa',
                type: 'select' as const,
                options: (boxes.data ?? [])
                  .filter((b) => b.status === 'active')
                  .map((b) => ({ value: b.id, label: `${b.name} (${b.email_address})` })),
                help: 'É necessário ter uma caixa conectada. O convite usa o SMTP dessa caixa.',
              },
            ]),
        {
          name: 'tenant_role',
          label: 'Papel na empresa',
          type: 'select',
          options: [
            { value: 'member', label: 'Membro' },
            { value: 'supervisor', label: 'Supervisor' },
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
          restrict_to_folders:
            (!isTenantAdmin(String(b.tenant_role)) &&
              roles.find((r) => r.mailbox_id === box.id)?.restrict_to_folders) ||
            false,
          folder_ids: roles.find((r) => r.mailbox_id === box.id)?.folder_ids ?? [],
        }));
        await api(
          platformTenantId
            ? '/superadmin/users/' + userId + '/access'
            : userId
              ? '/members/' + userId + '/access'
              : '/invitations',
          {
            method: userId ? 'PUT' : 'POST',
            body: {
              ...b,
              ...(platformTenantId ? { tenant_id: platformTenantId } : {}),
              capabilities: b.tenant_role === 'supervisor' ? capabilities : [],
              mailbox_roles: userId ? mailbox_roles : mailbox_roles.filter((b) => b.role),
            },
          },
        );
        await client.invalidateQueries();
        toast.success(userId ? 'Permissões atualizadas.' : 'Convite registrado para envio.');
        onDone();
      }}
      renderPreview={(values) => (
        <div className="space-y-4">
          {values.tenant_role === 'supervisor' && (
            <fieldset className="rounded-md border p-3 space-y-2">
              <legend>Permissões adicionais do supervisor</legend>
              {SUPERVISOR_CAPABILITIES.filter((cap) => cap !== 'dashboard').map((cap) => (
                <div key={cap} className="flex min-h-11 gap-2 items-center">
                  <Checkbox
                    id={'cap-' + cap}
                    checked={capabilities.includes(cap)}
                    onCheckedChange={(checked) =>
                      setCapabilities((prev) =>
                        checked ? [...prev, cap] : prev.filter((c) => c !== cap),
                      )
                    }
                  />
                  <Label htmlFor={'cap-' + cap}>{CAPABILITY_LABELS[cap]}</Label>
                </div>
              ))}
            </fieldset>
          )}
          {boxes.data?.map((box) => {
            const current = roles.find((r) => r.mailbox_id === box.id),
              role = current?.role ?? null;
            return (
              <fieldset key={box.id} className="space-y-3 rounded-md border p-3">
                <legend className="px-1 text-sm font-semibold">{box.name}</legend>
                <RadioGroup
                  value={role ?? 'none'}
                  onValueChange={(v) =>
                    setRoles((prev) => [
                      ...prev.filter((r) => r.mailbox_id !== box.id),
                      {
                        mailbox_id: box.id,
                        role: v === 'none' ? null : (v as MailboxRole),
                        restrict_to_folders: false,
                        folder_ids: [],
                      },
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
                {userId &&
                  !isTenantAdmin(String(values.tenant_role)) &&
                  (role === 'editor' || role === 'viewer') && (
                    <FolderAccessPicker
                      platformTenantId={platformTenantId}
                      mailboxId={box.id}
                      value={current ?? { restrict_to_folders: false, folder_ids: [] }}
                      onChange={(access) =>
                        setRoles((prev) =>
                          prev.map((r) => (r.mailbox_id === box.id ? { ...r, ...access } : r)),
                        )
                      }
                    />
                  )}
              </fieldset>
            );
          })}
        </div>
      )}
    >
      <p className="text-sm text-muted-foreground">
        Administradores e proprietários acessam todas as caixas como Admin da caixa.
      </p>
      <p className="text-xs text-muted-foreground">
        Somente leitura: ler. Editor: ler, responder, criar notas e assumir conversas. Admin da
        caixa: inclui organização, regras, atribuição e dashboard.
      </p>
    </SchemaForm>
  );
}
