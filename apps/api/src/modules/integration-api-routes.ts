/** Only routes explicitly published here can be granted to an integration key. */
export const integrationApiRoutes = [
  {
    permission: 'notifications:read',
    name: 'Consultar notificações de e-mails',
    description: 'Contagens de mensagens não lidas e conversas pendentes dos usuários autorizados.',
    method: 'GET',
    path: '/api/integrations/notifications',
  },
  {
    permission: 'messages:read',
    name: 'Consultar conteúdo de mensagens',
    description: 'Consulta completa e listagem incremental de mensagens das caixas autorizadas.',
    method: 'GET',
    path: '/api/integrations/messages',
  },
  {
    permission: 'messages:read',
    name: 'Consultar conteúdo de mensagens',
    description: 'Mensagens recebidas e enviadas de uma conversa autorizada.',
    method: 'GET',
    path: '/api/integrations/threads/:threadId',
  },
  {
    permission: 'attachments:download',
    name: 'Baixar anexos de mensagens',
    description:
      'Download autenticado, sujeito às permissões da mensagem e à análise de segurança.',
    method: 'GET',
    path: '/api/integrations/messages/:messageId/attachments/:attachmentId',
  },
] as const;
