import { z } from 'zod';
export const mailArchiveFormats = ['pst', 'ost', 'mbox', 'eml', 'emlx', 'zip'] as const;
export const MAIL_ARCHIVE_MAX_BYTES = 20 * 1024 ** 3;
export const MAIL_ARCHIVE_CHUNK_BYTES = 4 * 1024 ** 2;
export const MAIL_ARCHIVE_FINGERPRINT_BYTES = 64 * 1024;
export const MAIL_MESSAGE_MAX_BYTES = 50 * 1024 ** 2;
export const archivePreflightSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  size_bytes: z.number().int().positive().max(MAIL_ARCHIVE_MAX_BYTES),
  upload_fingerprint: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export function mailArchiveFormat(filename: string) {
  const extension = filename.toLowerCase().split('.').at(-1);
  return mailArchiveFormats.find((value) => value === extension) ?? null;
}
export function archiveQuotaCheck(bytes: bigint, used: bigint, limit: bigint | null) {
  const remaining = limit === null ? null : limit > used ? limit - used : 0n;
  return {
    allowed: remaining === null || bytes <= remaining,
    near_limit: limit !== null && (used + bytes) * 100n >= limit * 90n,
    remaining_bytes: remaining?.toString() ?? null,
  };
}
export type MailArchiveTask = {
  id: string;
  filename: string;
  format: string;
  size_bytes: string;
  uploaded_bytes: string;
  upload_fingerprint: string | null;
  analyzed_messages: number;
  expanded_bytes: string;
  processed_bytes: string;
  added_storage_bytes: string;
  analyzed_at: string | null;
  state: 'uploading' | 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  cursor: number;
  imported: number;
  skipped: number;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};
