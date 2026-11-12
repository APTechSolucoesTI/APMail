import { z } from 'zod';

// Zero means there is no lower date boundary for the initial IMAP import.
export const mailboxSyncDaysSchema = z.union([
  z.literal(30),
  z.literal(90),
  z.literal(180),
  z.literal(365),
  z.literal(1825),
  z.literal(3650),
  z.literal(0),
]);

export const MAILBOX_SYNC_OPTIONS = [
  { value: '30', label: '30 dias' },
  { value: '90', label: '90 dias' },
  { value: '180', label: '180 dias' },
  { value: '365', label: '1 ano' },
  { value: '1825', label: '5 anos' },
  { value: '3650', label: '10 anos' },
  { value: '0', label: 'Todo o histórico' },
];

export function mailboxSyncSince(days: z.infer<typeof mailboxSyncDaysSchema>): Date | null {
  return days === 0 ? null : new Date(Date.now() - days * 86400000);
}
