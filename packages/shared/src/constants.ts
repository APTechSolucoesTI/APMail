export const QUEUE_STATUSES = [
  'none',
  'to_reply',
  'in_progress',
  'awaiting_reply',
  'scheduled',
  'done',
] as const;
export type QueueStatus = (typeof QUEUE_STATUSES)[number];
export const QUEUE_LABELS: Record<QueueStatus, string> = {
  none: 'Sem fila',
  to_reply: 'A responder',
  in_progress: 'Em atendimento',
  awaiting_reply: 'Aguardando resposta',
  scheduled: 'Agendado',
  done: 'Concluído',
};
export const MAILBOX_LABELS = {
  pending: 'Verificando',
  active: 'Ativa',
  error: 'Erro de conexão',
  disabled: 'Desativada',
} as const;
export const OUTBOX_LABELS = {
  draft: 'Rascunho',
  queued: 'Na fila',
  scheduled: 'Agendado',
  sending: 'Enviando',
  sent: 'Enviado',
  failed: 'Falhou',
  canceled: 'Cancelado',
} as const;
export const ROLE_LABELS = {
  owner: 'Proprietário',
  admin: 'Administrador',
  member: 'Membro',
  supervisor: 'Supervisor',
  mailbox_admin: 'Admin da caixa',
  editor: 'Editor',
  viewer: 'Somente leitura',
} as const;
export const PAGE_SIZES = [10, 20, 30, 50, 100] as const;
export const PROVIDER_PRESETS = [
  {
    name: 'Hotmail / Outlook.com',
    imap_host: 'outlook.office365.com',
    smtp_host: 'smtp-mail.outlook.com',
    smtp_port: 587,
  },
  {
    name: 'Gmail / Google Workspace',
    imap_host: 'imap.gmail.com',
    smtp_host: 'smtp.gmail.com',
    smtp_port: 465,
  },
  {
    name: 'Outlook / Microsoft 365',
    imap_host: 'outlook.office365.com',
    smtp_host: 'smtp.office365.com',
    smtp_port: 587,
  },
  { name: 'Outro', imap_host: '', smtp_host: '', smtp_port: 465 },
] as const;
