import { queryOptions } from '@tanstack/react-query';
import { api } from './api';

export type AntivirusStatus = 'pending' | 'clean' | 'infected' | 'error';
export type AttachmentSecurity = {
  id: string | null;
  status: AntivirusStatus;
  threat_name: string | null;
  scanned_at: string | null;
  error_code: string | null;
  engine_version: string | null;
  definitions_at: string | null;
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
  security?.status === 'clean';
/** A completed verdict in freshly loaded mail/draft data supersedes an older query cache. */
export const resolvedAttachmentSecurity = (
  initial?: AttachmentSecurity | null,
  polled?: AttachmentSecurity,
) =>
  initial && ['clean', 'infected'].includes(initial.status)
    ? initial
    : (polled ?? initial ?? pendingSecurity);
const policyBlock = (security: Safety) =>
  /heuristics\.(encrypted|limits)|encrypted|limits.exceeded|size_limit/i.test(
    security.threat_name ?? security.error_code ?? '',
  );
export function antivirusStatusLabel(security: Safety | null | undefined) {
  if (!security || security.status === 'pending') return 'Verificação pendente';
  if (security.status === 'clean') return 'Verificado';
  if (policyBlock(security)) return 'Bloqueado por política';
  return security.status === 'infected' ? 'Ameaça detectada' : 'Verificação indisponível';
}
export function antivirusExplanation(security: Safety | null | undefined) {
  if (!security || security.status === 'pending')
    return 'Aguarde a verificação para abrir ou enviar este anexo.';
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
    enabled: !attachmentCanOpen(initial) && initial?.status !== 'infected',
    staleTime: 0,
    retry: 1,
    refetchInterval: (query) =>
      ['pending', 'error'].includes(query.state.data?.status ?? 'pending') ? 15000 : false,
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
  counts: Record<'total' | AntivirusStatus, number>;
};
