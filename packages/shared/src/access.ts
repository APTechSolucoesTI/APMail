import { z } from 'zod';
import { isTenantAdmin, type TenantRole } from './permissions.js';
import type { MailboxPerm } from './permissions.js';

export const ACCESS_PERMISSIONS = [
  {
    key: 'mail',
    group: 'Comunicação',
    label: 'E-mail',
    description:
      'Abrir caixas e mensagens. O acesso a cada caixa e pasta continua sendo respeitado.',
  },
  {
    key: 'mail.send',
    group: 'Comunicação',
    label: 'Enviar e responder',
    description: 'Compor, responder e encaminhar pelas caixas autorizadas.',
  },
  {
    key: 'mail.organize',
    group: 'Comunicação',
    label: 'Organizar e excluir mensagens',
    description: 'Mover, excluir, restaurar e sinalizar mensagens nas caixas autorizadas.',
  },
  {
    key: 'contacts',
    group: 'Comunicação',
    label: 'Contatos',
    description: 'Consultar, criar e editar contatos e empresas.',
  },
  {
    key: 'contacts.delete',
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
    group: 'Equipe e acesso',
    label: 'Convidar usuários',
    description:
      'Criar, reenviar e revogar convites. Não permite alterar acessos de usuários existentes.',
  },
  {
    key: 'users.manage',
    group: 'Equipe e acesso',
    label: 'Gerenciar usuários',
    description:
      'Alterar perfis, desativar e remover membros, sem conceder permissões superiores às próprias.',
  },
  {
    key: 'profiles.manage',
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
    key: 'audit.content',
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
  member_count: number;
  invitation_count: number;
};
export type AccessIdentity = {
  role?: TenantRole | null;
  access_permissions?: readonly string[] | null;
};
export function profileAllowsMailbox(identity: AccessIdentity, permission: MailboxPerm) {
  const required: AccessPermission =
    permission === 'send'
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
    'users.invite',
    'users.manage',
    'profiles.manage',
    'audit.content',
    'mailboxes.manage',
    'company.manage',
    'archives',
    'audit.view',
    'users.view',
  ].includes(permission);
}
export const permissionDependencies: Partial<Record<AccessPermission, AccessPermission[]>> = {
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
    ['/settings/access-profiles', 'profiles.manage'],
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
    ['/mail/', 'mail'],
  ];
  return prefixes.find(([prefix]) => path.startsWith(prefix))?.[1] ?? null;
}
