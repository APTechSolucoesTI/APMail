import type { ListResult } from './schemas/common.js';

/** Registered payload bytes, excluding database overhead, backups and RAM. */
export type StorageUsage = {
  content_bytes: number;
  attachment_bytes: number;
  shared_bytes: number;
  total_bytes: number;
  messages: number;
  source_mail_bytes: number;
};
export type StorageRow = StorageUsage & {
  id: string;
  tenant_id: string;
  tenant_name: string;
  name: string;
  email_address: string | null;
  retained_deleted: boolean;
};
export type PlatformStorageResult = ListResult<StorageRow> & {
  summary: StorageUsage;
  measured_at: string;
};
