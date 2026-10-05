export function formatStorageBytes(value: string | null | undefined): string {
  if (value == null) return 'Indisponível';
  const n = BigInt(value),
    absolute = n < 0n ? -n : n;
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'];
  let index = 0,
    divisor = 1n;
  while (absolute >= divisor * 1024n && index < units.length - 1) {
    index++;
    divisor *= 1024n;
  }
  if (!index) return `${n.toLocaleString('pt-BR')} B`;
  const whole = absolute / divisor,
    fraction = ((absolute % divisor) * 100n) / divisor;
  return `${n < 0n ? '-' : ''}${whole.toLocaleString('pt-BR')},${fraction.toString().padStart(2, '0')} ${units[index]}`;
}
export function storagePercentage(
  used: string | null | undefined,
  total: string | null | undefined,
): number | null {
  if (used == null || total == null || BigInt(total) <= 0n) return null;
  return Number((BigInt(used) * 10000n) / BigInt(total)) / 100;
}
export const storageQuality = {
  pending: 'Aguardando inventário',
  verified: 'Verificado',
  partial: 'Parcial',
};
export const integrityLabels: Record<string, string> = {
  missing_file: 'Arquivo ausente',
  unreadable_file: 'Arquivo inacessível',
  size_mismatch: 'Tamanho divergente',
  unreferenced_file: 'Arquivo sem referência',
  temporary_file: 'Arquivo temporário retido',
  cross_tenant_reference: 'Referência entre empresas',
  interrupted_operation: 'Operação interrompida',
};
export const categoryLabels: Record<string, string> = {
  attachment: 'Anexos',
  upload: 'Uploads',
  signature_image: 'Imagens de assinatura',
  avatar: 'Avatares',
  messages: 'Mensagens',
  outbox: 'Rascunhos e envios',
  signatures: 'Assinaturas',
  metadata: 'Metadados',
  platform_metadata: 'Identidades e gestão',
  contacts: 'Contatos',
  chat: 'Chat',
  rules: 'Regras',
  notes: 'Notas',
  audit: 'Auditoria',
  shared_file: 'Arquivo compartilhado',
  temporary: 'Temporários',
  unreferenced: 'Sem referência',
};
