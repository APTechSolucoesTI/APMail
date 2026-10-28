import { hasAccess, type AccessIdentity, type AccessPermission } from '@apmail/shared';
export const adminSections: {
  path: string;
  label: string;
  permission: AccessPermission;
  description: string;
}[] = [
  {
    path: '/admin/domains',
    label: 'Domínios',
    permission: 'domains.view',
    description: 'Endereços, registros DNS e autenticação de e-mail.',
  },
  {
    path: '/admin/mailboxes',
    label: 'Caixas de e-mail',
    permission: 'mailboxes.manage',
    description: 'Conexões, sincronização e acesso às caixas.',
  },
  {
    path: '/admin/users',
    label: 'Equipe e acesso',
    permission: 'users.view',
    description: 'Pessoas, convites e permissões da empresa.',
  },
  {
    path: '/admin/access-profiles',
    label: 'Perfis de acesso',
    permission: 'profiles.manage',
    description: 'Permissões e responsabilidades da equipe.',
  },
  {
    path: '/admin/company',
    label: 'Empresa',
    permission: 'company.manage',
    description: 'Cadastro, armazenamento e padrões de e-mail.',
  },
  {
    path: '/admin/integrations',
    label: 'Integrações',
    permission: 'integrations',
    description: 'Conexões e autorizações dos seus serviços.',
  },
  {
    path: '/admin/security/antivirus',
    label: 'Antivírus',
    permission: 'antivirus.view',
    description: 'Análise de arquivos e decisões de segurança.',
  },
  {
    path: '/admin/reports',
    label: 'Relatórios',
    permission: 'reports',
    description: 'Informações e exportações autorizadas.',
  },
  {
    path: '/admin/audit',
    label: 'Auditoria',
    permission: 'audit.view',
    description: 'Histórico de ações e alterações.',
  },
];
export function administrativeSections(identity: AccessIdentity) {
  return adminSections.filter((s) => hasAccess(identity, s.permission));
}
export function canAccessAdmin(identity: AccessIdentity) {
  return administrativeSections(identity).length > 0;
}
