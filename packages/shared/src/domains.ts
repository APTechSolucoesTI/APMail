import { z } from 'zod';
export function normalizeDomain(value: string): string {
  const input = value.trim().replace(/\.$/, '').toLowerCase();
  if (!input || /[\s/:@%*\\?#]/u.test(input))
    throw new Error('Informe somente o domínio, como empresa.com.br.');
  let name: string;
  try {
    name = z
      .url({ normalize: true })
      .parse('http://' + input)
      .slice(7)
      .replace(/\/$/, '');
  } catch {
    throw new Error('Domínio inválido.');
  }
  if (
    name.length > 253 ||
    !name.includes('.') ||
    /^\d+(\.\d+){3}$/.test(name) ||
    !name.split('.').every((p) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p))
  )
    throw new Error('Domínio inválido.');
  return name;
}
export const domainNameSchema = z
  .string()
  .max(300)
  .transform((v, ctx) => {
    try {
      return normalizeDomain(v);
    } catch (e) {
      ctx.addIssue({
        code: 'custom',
        message: e instanceof Error ? e.message : 'Domínio inválido.',
      });
      return z.NEVER;
    }
  });
export const domainUpdateSchema = z.object({
  dkim_selector: z
    .string()
    .trim()
    .max(63)
    .regex(/^[a-zA-Z0-9_-]*$/)
    .nullable(),
});
export type DomainOption = { id: string; domain: string; display_name: string };
export type DnsRecordState =
  'present' | 'missing' | 'invalid' | 'error' | 'not_checked' | 'not_applicable';
export type DnsRecordResult = {
  state: DnsRecordState;
  queried_name: string;
  values: string[];
  source_domain?: string;
  error_code?: 'timeout' | 'not_found' | 'resolver_error' | 'response_limit';
  message: string;
};
export type DomainDnsSnapshot = {
  checked_at: string | null;
  records: Record<'mx' | 'ns' | 'spf' | 'dmarc' | 'dkim', DnsRecordResult>;
};
export type TenantDomain = DomainOption & {
  dkim_selector: string | null;
  created_at: string;
  updated_at: string;
  check: DomainDnsSnapshot | null;
};
