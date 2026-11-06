/** Only routes explicitly published here can be granted to an integration key. */
export const integrationApiRoutes = [
  {
    permission: 'notifications:read',
    name: 'Consultar notificações de e-mails',
    description: 'Contagens de mensagens não lidas e conversas pendentes dos usuários autorizados.',
    method: 'GET',
    path: '/api/integrations/notifications',
  },
] as const;
