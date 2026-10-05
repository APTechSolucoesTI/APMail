import type { ListResult } from './schemas/common.js';
import { z } from 'zod';
export const hostMetricsSchema = z
  .object({
    version: z.literal(1),
    measured_at: z.iso.datetime(),
    backup: z
      .object({
        completed_at: z.iso.datetime().nullable(),
        checksum_verified: z.boolean(),
        restored_at: z.iso.datetime().nullable(),
        status: z.enum(['completed', 'failed']),
      })
      .strict()
      .nullable()
      .optional(),
    sources: z
      .array(
        z
          .object({
            id: z.enum(['storage', 'database', 'redis', 'backups', 'logs', 'api', 'worker', 'web']),
            available: z.boolean(),
            quality: z.enum(['verified', 'partial', 'unavailable']),
            apparent_bytes: z.string().regex(/^\d+$/).nullable(),
            allocated_bytes: z.string().regex(/^\d+$/).nullable(),
            files: z.number().int().nonnegative().nullable(),
            capacity_bytes: z.string().regex(/^\d+$/).nullable(),
            free_bytes: z.string().regex(/^\d+$/).nullable(),
            device: z.string().max(100).nullable(),
            memory_bytes: z.string().regex(/^\d+$/).nullable(),
            memory_limit_bytes: z.string().regex(/^\d+$/).nullable(),
            cpu_usage_microseconds: z.string().regex(/^\d+$/).nullable(),
            cpu_percent: z.number().nonnegative().nullable().default(null),
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export const STORAGE_FORMULA_VERSION = 'logical-json-v1';
export type MeteredUsage = {
  logical_bytes: string;
  body_bytes: string;
  metadata_bytes: string;
  file_bytes: string;
  allocated_bytes: string | null;
  attributed_bytes: string;
  retained_bytes: string;
  shared_file_bytes?: string;
  shared_logical_bytes?: string;
  retained_file_bytes?: string;
  retained_logical_bytes?: string;
  files: number;
  messages: number;
  discrepancies: number;
};
export type MeteredRow = MeteredUsage & {
  id: string;
  tenant_id: string | null;
  mailbox_id: string | null;
  name: string;
  tenant_name: string | null;
  email_address: string | null;
  status: string | null;
  scope: string;
  measured_at: string;
  formula_version: string;
  quality: 'pending' | 'verified' | 'partial';
  categories: { category: string; logical_bytes: string; file_bytes: string }[];
  retained_deleted: boolean;
  last_synced_at?: string | null;
  growth_bytes?: string | null;
  baseline_at?: string | null;
};
export type ScanRun = {
  id: string;
  mode: string;
  state: string;
  checked_files: string;
  error_count: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};
export type MeteringResult = ListResult<MeteredRow> & {
  summary_categories?: MeteredRow['categories'];
  selected_tenant?: MeteredRow | null;
  summary: MeteredUsage;
  latest_scan: ScanRun | null;
  latest_full_scan: ScanRun | null;
  stale: boolean;
  formula_version: string;
  measured_at: string | null;
};
export type ResourceSample = {
  source: string;
  measured_at: string;
  metrics: Record<string, unknown>;
};
export type PlatformOverview = {
  capacity_forecast: {
    days_remaining: number;
    daily_growth_bytes: string;
    baseline_at: string;
    measured_at: string;
  } | null;
  thresholds: {
    disk_warning_percent: number;
    disk_critical_percent: number;
    sync_delay_minutes: number;
    heartbeat_seconds: number;
  };
  counts: {
    tenants: number;
    suspended: number;
    mailboxes: number;
    mailbox_errors: number;
    mailbox_pending: number;
    users: number;
    platform_admins: number;
    invitations: number;
    messages: number;
    failed_sends: number;
    failed_invites: number;
    sync_delayed: number;
  };
  storage: MeteringResult;
  resources: ResourceSample[];
  queues: {
    name: string;
    waiting: number | null;
    active: number | null;
    delayed: number | null;
    failed: number | null;
    oldest_waiting_at: number | null;
  }[];
  worker_heartbeat: string | null;
  services: { database: string; redis: string };
  audit: { id: string; action: string; created_at: string; tenant_name: string | null }[];
};
export type StorageHistoryPoint = {
  quality?: 'pending' | 'verified' | 'partial';
  formula_version?: string;
  measured_at: string;
  attributed_bytes: string;
  file_bytes: string;
  logical_bytes: string;
  scope_id: string;
  scope: string;
};
