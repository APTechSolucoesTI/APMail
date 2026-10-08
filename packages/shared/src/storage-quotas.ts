import { z } from 'zod';

export const storageBytesSchema = z
  .string()
  .max(19, 'Informe uma capacidade de até 9.223.372.036.854.775.807 bytes.')
  .regex(/^\d+$/)
  .refine(
    (v) => /^\d{1,19}$/.test(v) && BigInt(v) <= 9223372036854775807n,
    'Armazenamento acima do limite suportado.',
  );
export const tenantQuotaSchema = z
  .object({
    max_mailboxes: z.number().int().min(0).max(100000).nullable(),
    storage_limit_bytes: storageBytesSchema.nullable(),
  })
  .strict();
export const allocationSchema = z
  .object({
    mode: z.enum(['equal', 'manual']),
    allocations: z
      .array(z.object({ mailbox_id: z.uuid(), bytes: storageBytesSchema }).strict())
      .max(100000)
      .default([]),
  })
  .strict();
export const storageUnits = {
  B: 1n,
  KB: 1000n,
  MB: 1000000n,
  GB: 1000000000n,
  TB: 1000000000000n,
  KiB: 1024n,
  MiB: 1048576n,
  GiB: 1073741824n,
  TiB: 1099511627776n,
};
export type StorageUnit = keyof typeof storageUnits;
/** Exact decimal conversion; never round a quota above its requested value. */
export function storageAmountBytes(amount: string, unit: StorageUnit): string {
  const value = amount.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,18})?$/.test(value))
    throw Error('Informe uma quantidade válida de armazenamento.');
  const [whole, fraction = ''] = value.split('.');
  const bytes =
    ((BigInt(whole!) * 10n ** BigInt(fraction.length) + BigInt(fraction || '0')) *
      storageUnits[unit]) /
    10n ** BigInt(fraction.length);
  return storageBytesSchema.parse(bytes.toString());
}
export function storageBytesAmount(bytes: string, unit: StorageUnit): string {
  const scale = 10n ** 18n,
    multiplier = storageUnits[unit];
  const scaled = (BigInt(bytes) * scale + multiplier - 1n) / multiplier;
  const fraction = (scaled % scale).toString().padStart(18, '0').replace(/0+$/, '');
  return `${scaled / scale}${fraction ? '.' + fraction : ''}`;
}
export function storagePercentageBytes(percent: string, cap: string): string {
  const value = percent.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,4})?$/.test(value) || Number(value) > 100)
    throw Error('Informe um percentual de 0 a 100, com até quatro casas decimais.');
  const [whole, fraction = ''] = value.split('.');
  return (
    (BigInt(cap) * (BigInt(whole!) * 10000n + BigInt(fraction.padEnd(4, '0')))) /
    1000000n
  ).toString();
}
export type MailboxQuota = {
  receiving_protocol?: 'imap' | 'pop3' | 'local';
  mailbox_id: string;
  tenant_id: string;
  name: string;
  email_address: string;
  used_bytes: string;
  allocated_bytes: string | null;
  paused_at: string | null;
  sync_checkpoint: {
    folder_id: string;
    uidvalidity: string;
    next_uid: number;
    last_uid: number;
    reason: string;
    tenant_used: string;
    mailbox_used: string;
    tenant_limit: string | null;
    mailbox_limit: string | null;
  } | null;
  provider_status: 'pending' | 'available' | 'unsupported' | 'error' | 'not_applicable';
  provider_used_bytes: string | null;
  provider_limit_bytes: string | null;
  provider_checked_at: string | null;
};
export type TenantQuota = {
  tenant_id: string;
  max_mailboxes: number | null;
  storage_limit_bytes: string | null;
  allocation_mode: 'equal' | 'manual';
  used_bytes: string;
  shared_bytes: string;
  allocated_bytes: string;
  remaining_allocation_bytes: string | null;
  provider: {
    used_bytes: string;
    limit_bytes: string;
    known: number;
    total: number;
    checked_at: string | null;
  };
  mailboxes: MailboxQuota[];
};
