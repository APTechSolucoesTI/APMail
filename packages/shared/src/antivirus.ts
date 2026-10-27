import { z } from 'zod';

export function antivirusFindingKind(file: {
  status: string;
  threat_name?: string | null;
  error_code?: string | null;
}) {
  if (
    file.status === 'infected' &&
    /^Heuristics\.Encrypted(?:\.[A-Za-z0-9_-]+)*$/i.test(file.threat_name ?? '')
  )
    return 'encrypted' as const;
  if (
    (file.status === 'infected' &&
      /^Heuristics\.Limits\.Exceeded(?:\.[A-Za-z0-9_-]+)*$/i.test(file.threat_name ?? '')) ||
    (file.status === 'error' && file.error_code === 'size_limit')
  )
    return 'limits' as const;
  if (file.status === 'infected') return 'malware' as const;
  return file.status === 'clean' ? ('clean' as const) : ('unverified' as const);
}
export const senderTrustSchema = z.object({
  sender: z
    .email()
    .max(254)
    .transform((value) => value.trim().toLowerCase()),
  mailbox_id: z.uuid().nullable().default(null),
  policy: z.enum(['encrypted', 'preventive']).default('encrypted'),
  notes: z.string().trim().max(2000).default(''),
  enabled: z.boolean().default(true),
  expires_at: z.iso.datetime().nullable().default(null),
});
export const fileReleaseSchema = z.object({
  file_ids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .transform((ids) => [...new Set(ids)]),
  reason: z.string().trim().min(8, 'Explique por que este arquivo pode ser liberado.').max(2000),
  false_positive: z.boolean().default(false),
  acknowledge_risk: z.literal(true, {
    error: 'Confirme que deseja liberar os arquivos selecionados.',
  }),
  acknowledge_malware: z.boolean().default(false),
  trust_sender: senderTrustSchema.optional(),
});
export type SenderTrustInput = z.infer<typeof senderTrustSchema>;
