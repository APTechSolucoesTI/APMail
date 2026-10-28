import { z } from 'zod';
import { isTenantAdmin, type TenantRole } from './permissions.js';
import type { MailboxPerm } from './permissions.js';

export const ACCESS_PERMISSIONS = [
  {
    key: 'domains.view',
    group: 'Administração',
    label: 'Visualizar domínios',
    description: 'Consultar domínios e seus registros DNS.',
  },
  {
    key: 'domains.manage',
    parent: 'domains.view',
    group: 'Administração',
    label: 'Gerenciar domínios',
    description: 'Cadastrar e configurar domínios da empresa.',
  },
  {
    key: 'mail',
    group: 'Comunicação',
    label: 'E-mail',
    description:
      'Abrir caixas e mensagens. O acesso a cada caixa e pasta continua sendo respeitado.',
  },
  {
    key: 'mail.send',
    parent: 'mail',
    group: 'Comunicação',
    label: 'Enviar e responder',
    description: 'Compor, responder e encaminhar pelas caixas autorizadas.',
  },
  {
    key: 'mail.organize',
    group: 'Comunicação',
    label: 'Organizar mensagens',
    parent: 'mail',
    description: 'Grupo de ações de organização; selecione abaixo cada ação autorizada.',
  },
  ...(['move', 'delete', 'restore', 'flag'] as const).map((action, index) => ({
    key: `mail.${action}` as const,
    group: 'Comunicação',
    parent: 'mail.organize',
    label: ['Mover mensagens', 'Excluir mensagens', 'Restaurar mensagens', 'Sinalizar mensagens'][
      index
    ]!,
    description: [
      'Mover entre pastas autorizadas.',
      'Mover para a Lixeira ou excluir definitivamente.',
      'Restaurar mensagens para a caixa de entrada.',
      'Adicionar ou remover sinalização.',
    ][index]!,
  })),
  {
    key: 'contacts',
    group: 'Comunicação',
    label: 'Contatos',
    description: 'Consultar contatos e empresas nos escopos autorizados.',
  },
  {
    key: 'contacts.create',
    group: 'Comunicação',
    parent: 'contacts',
    label: 'Criar contatos',
    description: 'Cadastrar contatos e empresas e importar novos cadastros.',
  },
  {
    key: 'contacts.edit',
    group: 'Comunicação',
    parent: 'contacts',
    label: 'Editar contatos',
    description: 'Editar dados e vincular endereços a contatos existentes.',
  },
  {
    key: 'contacts.delete',
    parent: 'contacts',
    group: 'Comunicação',
    label: 'Excluir contatos',
    description: 'Excluir contatos e empresas, conforme o escopo de compartilhamento.',
  },
  {
    key: 'chat',
    group: 'Comunicação',
    label: 'Chat da equipe',
    description: 'Acessar canais, conversas e arquivos do chat.',
  },
  {
    key: 'calendar',
    group: 'Produtividade',
    label: 'Calendário e reuniões',
    description: 'Gerenciar seus compromissos e convites.',
  },
  {
    key: 'reminders',
    group: 'Produtividade',
    label: 'Lembretes e tarefas',
    description: 'Gerenciar lembretes e tarefas pessoais.',
  },
  {
    key: 'schedules',
    group: 'Produtividade',
    label: 'Envios e agendamentos',
    description:
      'Consultar e gerenciar envios autorizados. Enviar também exige a permissão de envio.',
  },
  {
    key: 'reports',
    group: 'Análises',
    label: 'Relatórios e indicadores',
    description: 'Consultar relatórios nas caixas autorizadas.',
  },
  {
    key: 'users.view',
    group: 'Equipe e acesso',
    label: 'Consultar usuários',
    description: 'Visualizar a equipe e os convites pendentes.',
  },
  {
    key: 'users.invite',
    parent: 'users.view',
    group: 'Equipe e acesso',
    label: 'Convidar usuários',
    description:
      'Criar, reenviar e revogar convites. Não permite alterar acessos de usuários existentes.',
  },
  {
    key: 'users.manage',
    parent: 'users.view',
    group: 'Equipe e acesso',
    label: 'Gerenciar usuários',
    description:
      'Alterar perfis, desativar e remover membros, sem conceder permissões superiores às próprias.',
  },
  {
    key: 'profiles.manage',
    parent: 'users.view',
    group: 'Equipe e acesso',
    label: 'Perfis de acesso',
    description: 'Criar e editar perfis. Não permite conceder permissões superiores às próprias.',
  },
  {
    key: 'audit.view',
    group: 'Auditoria',
    label: 'Consultar auditoria',
    description:
      'Consultar o histórico da empresa, incluindo ações e destinatários. Contatos pessoais permanecem privados.',
  },
  {
    key: 'antivirus.view',
    group: 'Segurança',
    label: 'Consultar antivírus',
    description: 'Consultar arquivos, análises e decisões de segurança da empresa.',
  },
  {
    key: 'antivirus.release',
    parent: 'antivirus.view',
    group: 'Segurança',
    label: 'Liberar arquivos e avaliar falsos positivos',
    description: 'Liberar ou revogar o acesso a anexos e registrar possíveis falsos positivos.',
  },
  {
    key: 'antivirus.trust',
    parent: 'antivirus.view',
    group: 'Segurança',
    label: 'Gerenciar remetentes confiáveis',
    description:
      'Autorizar automaticamente os anexos de remetentes, definir validade e revogar confiança.',
  },
  {
    key: 'audit.content',
    parent: 'audit.view',
    group: 'Auditoria',
    label: 'Consultar conteúdo auditado',
    description:
      'Abrir o texto preservado de mensagens enviadas, respondidas e excluídas. Inclui conteúdo sensível de e-mail.',
  },
  {
    key: 'mailboxes.manage',
    group: 'Configurações',
    label: 'Configurar caixas',
    description: 'Gerenciar conexões e credenciais de caixas da empresa.',
  },
  {
    key: 'company.manage',
    group: 'Configurações',
    label: 'Configurar empresa',
    description: 'Editar os dados e parâmetros da empresa.',
  },
  {
    key: 'integrations',
    group: 'Configurações',
    label: 'Integrações pessoais',
    description: 'Configurar integrações de sua própria conta.',
  },
  {
    key: 'signatures',
    group: 'Configurações',
    label: 'Assinaturas',
    description: 'Gerenciar suas assinaturas de e-mail.',
  },
  {
    key: 'labels',
    group: 'Configurações',
    label: 'Etiquetas',
    description: 'Gerenciar etiquetas nos escopos autorizados.',
  },
  {
    key: 'rules',
    group: 'Configurações',
    label: 'Regras de e-mail',
    description: 'Configurar regras nas caixas autorizadas.',
  },
  {
    key: 'archives',
    group: 'Configurações',
    label: 'Importar e exportar e-mails',
    description: 'Gerenciar arquivos e exportações das caixas autorizadas.',
  },
] as const;
export type AccessPermission = (typeof ACCESS_PERMISSIONS)[number]['key'];
export const permissionKeys = ACCESS_PERMISSIONS.map((p) => p.key);
export const accessPermissionSchema = z.enum(permissionKeys);
export const accessProfileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).default(''),
  permissions: z
    .array(accessPermissionSchema)
    .max(permissionKeys.length)
    .transform((p) => [...new Set(p)]),
});
export type AccessProfile = z.infer<typeof accessProfileSchema> & {
  id: string;
  system_role?: TenantRole | null;
  member_count: number;
  invitation_count: number;
};
export type AccessIdentity = {
  role?: TenantRole | null;
  access_permissions?: readonly string[] | null;
};
export function profileAllowsMailbox(identity: AccessIdentity, permission: MailboxPerm) {
  const required: AccessPermission = ['move', 'delete', 'restore', 'flag'].includes(permission)
    ? (`mail.${permission}` as AccessPermission)
    : permission === 'send'
      ? 'mail.send'
      : permission === 'rules'
        ? 'rules'
        : permission === 'dashboard'
          ? 'reports'
          : ['organize', 'queue', 'assign_others'].includes(permission)
            ? 'mail.organize'
            : 'mail';
  return hasAccess(identity, required);
}
/** Null/undefined preserves the legacy model. An empty custom profile denies all product modules. */
export function hasAccess(
  identity: AccessIdentity | null | undefined,
  permission: AccessPermission,
) {
  if (!identity) return false;
  if (identity.access_permissions != null) return identity.access_permissions.includes(permission);
  if (isTenantAdmin(identity.role)) return true;
  return ![
    'domains.view',
    'domains.manage',
    'users.invite',
    'users.manage',
    'profiles.manage',
    'audit.content',
    'mailboxes.manage',
    'company.manage',
    'archives',
    'audit.view',
    'users.view',
    'antivirus.view',
    'antivirus.release',
    'antivirus.trust',
  ].includes(permission);
}
export const permissionDependencies: Partial<Record<AccessPermission, AccessPermission[]>> = {
  'domains.manage': ['domains.view'],
  'antivirus.release': ['antivirus.view'],
  'antivirus.trust': ['antivirus.view'],
  'profiles.manage': ['users.view'],
  schedules: ['mail'],
  reports: ['mail'],
  rules: ['mail'],
  signatures: ['mail'],
  labels: ['mail'],
  archives: ['mail'],
  'mailboxes.manage': ['mail'],
  'mail.send': ['mail'],
  'mail.organize': ['mail'],
  'mail.move': ['mail.organize', 'mail'],
  'mail.delete': ['mail.organize', 'mail'],
  'mail.restore': ['mail.organize', 'mail'],
  'mail.flag': ['mail.organize', 'mail'],
  'contacts.create': ['contacts'],
  'contacts.edit': ['contacts'],
  'contacts.delete': ['contacts'],
  'users.invite': ['users.view'],
  'users.manage': ['users.view'],
  'audit.content': ['audit.view'],
};
export const profileMissingDependencies = (permissions: readonly string[]) =>
  Object.entries(permissionDependencies).flatMap(([key, required]) =>
    permissions.includes(key) ? required.filter((p) => !permissions.includes(p)) : [],
  );

export function screenPermission(path: string): AccessPermission | null {
  const prefixes: [string, AccessPermission][] = [
    ['/admin/domains', 'domains.view'],
    ['/admin/mailboxes', 'mailboxes.manage'],
    ['/admin/user-permissions', 'users.manage'],
    ['/admin/access-profiles', 'profiles.manage'],
    ['/admin/users', 'users.view'],
    ['/admin/company', 'company.manage'],
    ['/admin/integrations', 'integrations'],
    ['/admin/audit', 'audit.view'],
    ['/admin/security/antivirus', 'antivirus.view'],
    ['/admin/reports', 'reports'],
    ['/security/antivirus', 'antivirus.view'],
    ['/settings/access-profiles', 'profiles.manage'],
    ['/settings/user-permissions', 'users.manage'],
    ['/settings/users', 'users.view'],
    ['/settings/audit', 'audit.view'],
    ['/settings/mailboxes', 'mailboxes.manage'],
    ['/settings/tenant', 'company.manage'],
    ['/settings/integrations', 'integrations'],
    ['/settings/signatures', 'signatures'],
    ['/settings/labels', 'labels'],
    ['/settings/rules', 'rules'],
    ['/calendar', 'calendar'],
    ['/reminders', 'reminders'],
    ['/scheduled', 'schedules'],
    ['/contacts', 'contacts'],
    ['/chat', 'chat'],
    ['/reports', 'reports'],
    ['/dashboard', 'reports'],
    ['/mail-summary', 'mail'],
    ['/mail/', 'mail'],
  ];
  return prefixes.find(([prefix]) => path.startsWith(prefix))?.[1] ?? null;
}

/** Mirrors the existing role/capability gates; mailbox and folder grants remain independent. */
export function legacyAccessPermissions(
  role: TenantRole,
  capabilities: readonly string[] = [],
): AccessPermission[] {
  if (isTenantAdmin(role)) return ACCESS_PERMISSIONS.map((p) => p.key);
  const result = ACCESS_PERMISSIONS.filter((permission) => hasAccess({ role }, permission.key)).map(
    (p) => p.key,
  );
  const delegated: Partial<Record<AccessPermission, string>> = {
    'users.view': 'members',
    'audit.view': 'audit',
  };
  return [
    ...new Set([
      ...result,
      ...Object.entries(delegated)
        .filter(([, capability]) => role === 'supervisor' && capabilities.includes(capability!))
        .map(([key]) => key as AccessPermission),
    ]),
  ];
}

/** Personal snapshots preserve the legacy scope boundary for shared contact deletion. */
export function canManageTenantContacts(
  identity:
    | {
        role?: TenantRole | null;
        capabilities?: readonly string[];
        access_profile_id?: string | null;
        access_permissions?: readonly string[] | null;
      }
    | undefined,
) {
  if (!identity || !hasAccess(identity, 'contacts.delete')) return false;
  return (
    !!identity.access_profile_id ||
    isTenantAdmin(identity.role) ||
    (identity.role === 'supervisor' && !!identity.capabilities?.includes('contacts_manage'))
  );
}
