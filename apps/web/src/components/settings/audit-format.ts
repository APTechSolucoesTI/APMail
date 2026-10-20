import { ACCESS_PERMISSIONS, AUDIT_ACTION_LABELS, ROLE_LABELS } from '@apmail/shared';
export type AuditEntry = {
  id: string;
  action: string;
  actor_name: string | null;
  actor_email: string | null;
  actor_id: string | null;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
  ip: string | null;
  mailbox_id: string | null;
  message_subject: string | null;
  has_content: boolean;
  message_content?: string | null;
  can_read_content?: boolean;
  request_id?: string | null;
};
export const entityLabels: Record<string, string> = {
  user: 'Usuário',
  tenant: 'Empresa',
  mailbox: 'Caixa de e-mail',
  folder: 'Pasta',
  rule: 'Regra',
  message: 'E-mail',
  outbox: 'Envio',
  thread: 'Conversa',
  contact: 'Contato',
  company: 'Empresa de contato',
  invitation: 'Convite de usuário',
  calendar: 'Compromisso',
  calendar_event: 'Compromisso',
  reminder: 'Lembrete',
  signature: 'Assinatura',
  access_profile: 'Perfil de acesso',
  audit: 'Auditoria',
  label: 'Etiqueta',
  note: 'Nota interna',
  integration: 'Integração',
};
const fieldLabels: Record<string, string> = {
  affected_user: 'Usuário afetado',
  value: 'Valor',
  from_user_id: 'Responsável anterior',
  to_user_id: 'Novo responsável',
  audit_id: 'Registro de auditoria',
  profile_name: 'Perfil de acesso',
  name: 'Nome',
  description: 'Descrição',
  email: 'E-mail',
  full_name: 'Nome',
  tenant_role: 'Papel',
  role: 'Papel',
  permissions: 'Permissões',
  capabilities: 'Permissões adicionais',
  access_profile_id: 'Perfil de acesso',
  status: 'Status',
  title: 'Título',
  scope: 'Visibilidade',
  user_id: 'Usuário',
  userId: 'Usuário',
  assigned_user_id: 'Responsável',
  assigned_to: 'Responsável',
  previous_role: 'Papel anterior',
  subject: 'Assunto',
  from_address: 'Remetente',
  from_name: 'Nome do remetente',
  to: 'Para',
  cc: 'Cc',
  bcc: 'Cco',
  kind: 'Tipo de envio',
  scheduled_at: 'Agendado para',
  request_read_receipt: 'Confirmação de leitura solicitada',
  previous_folder_id: 'Pasta anterior',
  target_folder_id: 'Pasta de destino',
  permanent: 'Exclusão definitiva',
  reason: 'Motivo',
  flagged: 'Sinalizada',
  outcome: 'Resultado',
  operation_id: 'Operação',
  reply_to_message_id: 'Mensagem respondida',
  message_id: 'Message-ID',
  outbox_id: 'Envio',
  thread_id: 'Conversa',
  message_ids: 'Mensagens',
  records: 'Registros exportados',
  from: 'Início do período',
  to_date: 'Fim do período',
  attempt: 'Tentativa',
  filename: 'Arquivo',
  size_bytes: 'Tamanho em bytes',
  content_type: 'Tipo de arquivo',
  folder_ids: 'Pastas autorizadas',
  restrict_to_folders: 'Acesso restrito a pastas',
  mailbox_roles: 'Acesso às caixas',
  mailbox_id: 'Caixa de e-mail',
  enabled: 'Ativado',
  action: 'Ação',
  response: 'Resposta',
  starts_at: 'Início',
  ends_at: 'Término',
  all_day: 'Dia inteiro',
  location: 'Local',
  attendee_emails: 'Participantes',
  remind_before_minutes: 'Antecedência do lembrete (minutos)',
  timezone: 'Fuso horário',
};
const values: Record<string, string> = {
  ...ROLE_LABELS,
  completed: 'Concluído',
  requested: 'Solicitado',
  failed: 'Falhou',
  queued: 'Na fila',
  scheduled: 'Agendado',
  sent: 'Enviado',
  draft: 'Rascunho',
  active: 'Ativo',
  disabled: 'Desativado',
  removed: 'Removido',
  tenant: 'Compartilhado com a empresa',
  personal: 'Pessoal',
  new: 'Novo e-mail',
  reply: 'Resposta',
  reply_all: 'Resposta a todos',
  forward: 'Encaminhamento',
  accepted: 'Aceito',
  declined: 'Recusado',
  tentative: 'Tentativa',
};
export const fieldLabel = (key: string) =>
  fieldLabels[key] ?? key.replace(/[_-]/g, ' ').replace(/^./, (c) => c.toUpperCase());
export const actionLabel = (action: string) =>
  AUDIT_ACTION_LABELS[action] ?? fieldLabel(action.replaceAll('.', ' '));
export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function humanValue(value: unknown, references: Record<string, unknown> = {}): string {
  if (value === null || value === undefined || value === '') return 'Não informado';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value))
    return value.length ? value.map((item) => humanValue(item, references)).join(', ') : 'Nenhum';
  if (typeof value === 'object') {
    const r = record(value);
    const address = r.email ?? r.address;
    if (typeof address === 'string') return (r.name ? r.name + ' — ' : '') + address;
    return Object.entries(r)
      .map(([k, v]) => fieldLabel(k) + ': ' + humanValue(v, references))
      .join(' · ');
  }
  if (typeof references[String(value)] === 'string') return references[String(value)] as string;
  return (
    ACCESS_PERMISSIONS.find((p) => p.key === value)?.label ?? values[String(value)] ?? String(value)
  );
}
export function auditOutcome(e: Pick<AuditEntry, 'action' | 'metadata'>) {
  const result = e.metadata.outcome;
  if (result === 'failed' || /failed|error/.test(e.action))
    return { label: 'Falhou', variant: 'danger' as const };
  if (result === 'requested' || /requested|queued|scheduled$/.test(e.action))
    return { label: 'Solicitado', variant: 'warning' as const };
  if (result === 'completed') return { label: 'Concluído', variant: 'success' as const };
  return { label: 'Registrado', variant: 'neutral' as const };
}
export function auditSummary(e: AuditEntry) {
  if (e.message_subject) return e.message_subject;
  const meta = e.metadata,
    next = record(meta.after);
  return String(
    meta.name ??
      meta.email ??
      meta.title ??
      next.name ??
      next.full_name ??
      entityLabels[e.entity_type] ??
      'Registro do sistema',
  );
}
