import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  emailSchema,
  tenantSchema,
  signupSchema,
  passwordSchema,
  fullNameSchema,
  mailboxSchema,
  memberAccessSchema,
} from '@apmail/shared';
import { api } from '@/lib/api';
import { SchemaForm, type FormField } from '@/components/forms/schema-form';
import { AccessEditor } from '@/components/forms/access-editor';
import { connectionFields } from '@/components/forms/mailbox-wizard';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

export type PlatformRow = {
  id: string;
  name?: string;
  slug?: string;
  full_name?: string;
  email?: string;
  suspended_at?: string | null;
  tenant_id?: string;
  platform_admin?: boolean;
  [key: string]: unknown;
};
export type ManagementDialog = {
  kind:
    | 'tenant-create'
    | 'tenant-edit'
    | 'user-create'
    | 'user-edit'
    | 'invite'
    | 'mailbox-create'
    | 'mailbox-edit'
    | 'access';
  tenantId?: string;
  row?: PlatformRow;
};
const titles = {
  'tenant-create': 'Criar empresa',
  'tenant-edit': 'Editar empresa',
  'user-create': 'Adicionar usuário',
  'user-edit': 'Editar usuário',
  invite: 'Convidar usuário',
  'mailbox-create': 'Adicionar caixa de e-mail',
  'mailbox-edit': 'Editar caixa de e-mail',
  access: 'Permissões do usuário',
};
const roleField: FormField = {
  name: 'tenant_role',
  label: 'Papel na empresa',
  type: 'select',
  options: [
    { value: 'owner', label: 'Proprietário' },
    { value: 'admin', label: 'Administrador' },
    { value: 'member', label: 'Membro' },
    { value: 'supervisor', label: 'Supervisor' },
  ],
};

export function PlatformManagementDialog({
  dialog,
  tenantName,
  onClose,
  onSaved,
}: {
  dialog: ManagementDialog | null;
  tenantName?: string;
  onClose: () => void;
  onSaved: (result?: { tenant?: PlatformRow; user?: PlatformRow }) => Promise<void>;
}) {
  const config = useQuery({
    queryKey: ['platform', 'mailbox-config', dialog?.tenantId, dialog?.row?.id],
    queryFn: () =>
      api<Record<string, unknown>>(
        '/superadmin/tenants/' + dialog?.tenantId + '/mailboxes/' + dialog?.row?.id,
      ),
    enabled: dialog?.kind === 'mailbox-edit',
  });
  return (
    <Dialog
      open={!!dialog}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialog ? titles[dialog.kind] : 'Gestão da empresa'}</DialogTitle>
          <DialogDescription>
            {dialog?.kind === 'tenant-create'
              ? 'Cadastre a empresa e indique seu proprietário.'
              : `Empresa: ${tenantName ?? ''}. Alterações registradas na auditoria.`}
          </DialogDescription>
        </DialogHeader>
        {dialog?.kind === 'access' && (
          <AccessEditor
            key={dialog.tenantId + ':' + dialog.row?.id}
            userId={dialog.row?.id}
            platformTenantId={dialog.tenantId}
            onDone={() => void onSaved()}
          />
        )}
        {(dialog?.kind === 'tenant-create' || dialog?.kind === 'tenant-edit') && (
          <SchemaForm
            key={dialog.kind + ':' + dialog.row?.id}
            schema={
              dialog.kind === 'tenant-create'
                ? tenantSchema.extend({ owner_email: emailSchema })
                : tenantSchema
            }
            defaults={
              dialog.kind === 'tenant-edit'
                ? { name: dialog.row?.name, slug: dialog.row?.slug }
                : {}
            }
            fields={[
              { name: 'name', label: 'Nome da empresa' },
              { name: 'slug', label: 'Identificador' },
              ...(dialog.kind === 'tenant-create'
                ? [{ name: 'owner_email', label: 'E-mail do proprietário', type: 'email' as const }]
                : []),
            ]}
            onSubmit={async (b) => {
              if (dialog.kind === 'tenant-create') {
                const tenant = await api<PlatformRow>('/superadmin/tenants', {
                  method: 'POST',
                  body: b,
                });
                await onSaved({ tenant });
              } else {
                await api('/superadmin/tenants/' + dialog.tenantId, { method: 'PATCH', body: b });
                await onSaved();
              }
            }}
          />
        )}
        {(dialog?.kind === 'user-create' || dialog?.kind === 'user-edit') && (
          <>
            {dialog.kind === 'user-edit' && (
              <p className="text-sm text-muted-foreground">
                Nome, e-mail e senha pertencem à conta e valem para todas as empresas às quais ela
                está vinculada.
              </p>
            )}
            <SchemaForm
              key={dialog.kind + ':' + dialog.row?.id}
              schema={
                dialog.kind === 'user-create'
                  ? signupSchema.extend({ tenant_role: memberAccessSchema.shape.tenant_role })
                  : z.object({
                      full_name: fullNameSchema,
                      email: emailSchema,
                      password: passwordSchema.or(z.literal('')).optional(),
                    })
              }
              defaults={
                dialog.kind === 'user-create'
                  ? { tenant_role: 'member' }
                  : { full_name: dialog.row?.full_name, email: dialog.row?.email, password: '' }
              }
              fields={[
                { name: 'full_name', label: 'Nome completo' },
                { name: 'email', label: 'E-mail', type: 'email' },
                {
                  name: 'password',
                  label: dialog.kind === 'user-create' ? 'Senha inicial' : 'Nova senha (opcional)',
                  type: 'password',
                  autoComplete: 'new-password',
                  help:
                    dialog.kind === 'user-create'
                      ? 'Compartilhe a senha inicial com o usuário. Você poderá definir as caixas e permissões na próxima etapa.'
                      : 'Deixe em branco para manter a senha. Alterar e-mail ou senha encerra as sessões atuais.',
                },
                ...(dialog.kind === 'user-create' ? [roleField] : []),
              ]}
              submitLabel={
                dialog.kind === 'user-create' ? 'Criar e configurar acessos' : 'Salvar alterações'
              }
              onSubmit={async (b) => {
                if (dialog.kind === 'user-create') {
                  const user = await api<PlatformRow>(
                    '/superadmin/tenants/' + dialog.tenantId + '/users',
                    { method: 'POST', body: b },
                  );
                  await onSaved({ user });
                } else {
                  await api('/superadmin/users/' + dialog.row?.id, {
                    method: 'PATCH',
                    body: { ...b, password: b.password || undefined, tenant_id: dialog.tenantId },
                  });
                  await onSaved();
                }
              }}
            />
          </>
        )}
        {dialog?.kind === 'invite' && (
          <SchemaForm
            schema={z.object({
              email: emailSchema,
              tenant_role: memberAccessSchema.shape.tenant_role,
            })}
            defaults={{ tenant_role: 'member' }}
            fields={[{ name: 'email', label: 'E-mail', type: 'email' }, roleField]}
            submitLabel="Enviar convite pelo SMTP global"
            onSubmit={async (b) => {
              await api('/superadmin/invitations', {
                method: 'POST',
                body: { ...b, tenant_id: dialog.tenantId, mailbox_roles: [] },
              });
              await onSaved();
            }}
          />
        )}
        {(dialog?.kind === 'mailbox-create' || dialog?.kind === 'mailbox-edit') &&
          (dialog.kind === 'mailbox-edit' && config.isLoading ? (
            <LoadingState />
          ) : dialog.kind === 'mailbox-edit' && (config.error || !config.data) ? (
            <ErrorState onRetry={() => void config.refetch()} />
          ) : (
            <SchemaForm
              key={dialog.kind + ':' + dialog.row?.id}
              schema={
                dialog.kind === 'mailbox-create'
                  ? mailboxSchema.omit({ members: true })
                  : mailboxSchema
                      .omit({ members: true, sync_days: true, password: true })
                      .extend({ password: z.string().max(256).optional() })
              }
              defaults={
                dialog.kind === 'mailbox-create'
                  ? {
                      imap_port: 993,
                      imap_secure: true,
                      smtp_port: 465,
                      smtp_secure: true,
                      sync_days: 90,
                      history_classify_days: 0,
                      aliases: [],
                      append_sent_copy: true,
                      from_name_template: '{mailbox_name}',
                    }
                  : { ...config.data, password: '' }
              }
              fields={[
                { name: 'name', label: 'Nome da caixa' },
                { name: 'email_address', label: 'E-mail da caixa', type: 'email' },
                ...connectionFields.map((field) =>
                  field.name === 'password' && dialog.kind === 'mailbox-edit'
                    ? { ...field, help: 'Deixe em branco para manter a senha atual.' }
                    : field,
                ),
                {
                  name: 'from_name_template',
                  label: 'Nome exibido nos envios',
                  help: 'Use {mailbox_name} e {user_name} para personalizar.',
                },
                { name: 'append_sent_copy', label: 'Salvar cópia em Enviados', type: 'checkbox' },
                ...(dialog.kind === 'mailbox-create'
                  ? [
                      {
                        name: 'sync_days',
                        label: 'Importar histórico (30, 90, 180 ou 365 dias)',
                        type: 'number' as const,
                      },
                      {
                        name: 'history_classify_days',
                        label: 'Classificar filas dos últimos dias (0–90)',
                        type: 'number' as const,
                        help: '0 mantém o histórico sem fila.',
                      },
                    ]
                  : []),
              ]}
              submitLabel={
                dialog.kind === 'mailbox-create'
                  ? 'Testar conexão e adicionar'
                  : 'Salvar alterações'
              }
              onSubmit={async (b) => {
                await api(
                  '/superadmin/mailboxes' +
                    (dialog.kind === 'mailbox-edit' ? '/' + dialog.row?.id : ''),
                  {
                    method: dialog.kind === 'mailbox-edit' ? 'PATCH' : 'POST',
                    body: { ...b, tenant_id: dialog.tenantId, password: b.password || undefined },
                  },
                );
                await onSaved();
              }}
            />
          ))}
      </DialogContent>
    </Dialog>
  );
}
