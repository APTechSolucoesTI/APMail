import { queryOptions } from '@tanstack/react-query';
import { api } from './api';
import { antivirusFindingKind } from '@apmail/shared';

export type AntivirusStatus = 'pending' | 'clean' | 'infected' | 'error';
export type AttachmentSecurity = {
  id: string | null;
  status: AntivirusStatus;
  threat_name: string | null;
  scanned_at: string | null;
  error_code: string | null;
  engine_version: string | null;
  definitions_at: string | null;
  updated_at?: string | null;
  access_allowed?: boolean;
  released_at?: string | null;
  released_by?: string | null;
  released_by_name?: string | null;
  release_reason?: string | null;
  release_kind?: string | null;
  release_rule_id?: string | null;
  false_positive?: boolean;
};
type Safety = Pick<AttachmentSecurity, 'status'> & Partial<AttachmentSecurity>;
export const pendingSecurity: AttachmentSecurity = {
  id: null,
  status: 'pending',
  threat_name: null,
  scanned_at: null,
  error_code: null,
  engine_version: null,
  definitions_at: null,
};
export const attachmentCanOpen = (security: Safety | null | undefined) =>
  security?.status === 'clean' || security?.access_allowed === true;
/** A completed verdict in freshly loaded mail/draft data supersedes an older query cache. */
export const resolvedAttachmentSecurity = (
  initial?: AttachmentSecurity | null,
  polled?: AttachmentSecurity,
) =>
  initial?.updated_at && polled?.updated_at
    ? initial.updated_at > polled.updated_at
      ? initial
      : polled
    : initial && ['clean', 'infected'].includes(initial.status)
      ? initial
      : (polled ?? initial ?? pendingSecurity);
const policyBlock = (security: Safety) =>
  ['encrypted', 'limits'].includes(antivirusFindingKind(security));
export function antivirusStatusLabel(security: Safety | null | undefined) {
  if (!security || security.status === 'pending') return 'Verificação pendente';
  if (security.status === 'clean') return 'Verificado';
  if (security.access_allowed)
    return security.release_kind === 'sender' ? 'Remetente confiável' : 'Liberado manualmente';
  if (policyBlock(security)) return 'Bloqueado por política';
  return security.status === 'infected' ? 'Ameaça detectada' : 'Verificação indisponível';
}
export function antivirusExplanation(security: Safety | null | undefined) {
  if (!security || security.status === 'pending')
    return 'Aguarde a verificação para abrir ou enviar este anexo.';
  if (security.status !== 'clean' && security.access_allowed)
    return (
      (security.release_kind === 'sender'
        ? 'Liberado por uma regra de confiança.'
        : 'Liberado por um administrador.') +
      ' O resultado original do ClamAV foi preservado.' +
      (security.release_reason ? ' Motivo: ' + security.release_reason : '')
    );
  if (policyBlock(security))
    return 'Arquivo protegido ou acima dos limites de análise. O bloqueio preventivo não confirma a presença de malware.';
  if (security.status === 'clean') return 'Nenhuma ameaça encontrada na última verificação.';
  if (security.status === 'infected')
    return 'Acesso bloqueado: o antivírus identificou uma ameaça.';
  return 'Não foi possível verificar este arquivo. O acesso permanece bloqueado até uma análise bem-sucedida.';
}
export function attachmentSecurityQuery(
  tenant: string | null,
  kind: 'upload' | 'attachment',
  id: string,
  initial?: AttachmentSecurity | null,
) {
  return queryOptions({
    queryKey: ['attachment-security', tenant, kind, id],
    queryFn: ({ signal }) =>
      api<AttachmentSecurity>(
        `/${kind === 'upload' ? 'uploads' : 'attachments'}/${encodeURIComponent(id)}/security`,
        { signal },
      ),
    initialData: initial ?? pendingSecurity,
    enabled: initial?.status !== 'clean',
    staleTime: 0,
    retry: 1,
    refetchInterval: (query) => (query.state.data?.status !== 'clean' ? 15000 : false),
  });
}
export type AntivirusFile = AttachmentSecurity & {
  id: string;
  file_id?: string | null;
  filename: string;
  kind: string;
  content_type: string;
  size_bytes: number;
  error_message: string | null;
  signature_version: string | null;
  created_at: string;
  sender?: string | null;
  mailbox: { id: string; name: string; email_address: string } | null;
  message: { id: string; thread_id: string; subject: string } | null;
};
export type AntivirusOverview = {
  health: {
    status: 'online' | 'offline' | 'error' | 'unavailable';
    engine_version: string | null;
    signature_version: string | null;
    definitions_at: string | null;
    checked_at: string | null;
    error_code: string | null;
    stale: boolean;
    age_hours: number | null;
  };
  counts: Record<'total' | AntivirusStatus, number> & { released?: number; blocked?: number };
};
export type ReleaseTarget = AttachmentSecurity & {
  id: string;
  filename: string;
  kind: string;
  mailbox_id?: string | null;
  sender?: string | null;
};
export type SenderTrustRule = {
  id: string;
  sender: string;
  mailbox_id: string | null;
  mailbox_name: string | null;
  mailbox_email: string | null;
  policy: 'encrypted' | 'preventive';
  notes: string;
  enabled: boolean;
  expires_at: string | null;
  created_at: string;
  creator_name: string | null;
};
