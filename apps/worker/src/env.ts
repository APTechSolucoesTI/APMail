import { loadRootEnv, resolveWorkspacePath } from '@apmail/db';
import { z } from 'zod';
loadRootEnv();
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  APP_URL: z.url(),
  LOG_LEVEL: z.string().default('info'),
  STORAGE_DIR: z.string().default('./.data/storage').transform(resolveWorkspacePath),
  SESSION_SECRET: z.string().refine((value) => Buffer.from(value, 'base64').length === 32),
  CREDENTIALS_ENCRYPTION_KEY: z
    .string()
    .refine((value) => Buffer.from(value, 'base64').length === 32),
  WORKER_SYNC_EVERY_SECONDS: z.coerce.number().int().positive().default(60),
  WORKER_RECONCILE_EVERY_MINUTES: z.coerce.number().int().positive().default(10),
  WORKER_SYNC_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WORKER_SEND_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WORKER_ACTIONS_CONCURRENCY: z.coerce.number().int().positive().default(5),
  SYSTEM_SMTP_HOST: z.string().default('localhost'),
  SYSTEM_SMTP_PORT: z.coerce.number().default(1025),
  SYSTEM_SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  SYSTEM_SMTP_USER: z.string().default(''),
  SYSTEM_SMTP_PASSWORD: z.string().default(''),
  SYSTEM_MAIL_FROM: z.string().default('APMail <nao-responda@apmail.local>'),
  ALLOW_INSECURE_TLS_HOSTS: z.string().default('localhost,127.0.0.1'),
  WORKER_SEND_BACKOFF_MS: z.string().default(''),
  STORAGE_SCAN_BATCH: z.coerce.number().int().min(100).max(10000).default(5000),
  STORAGE_SCAN_BUDGET_MS: z.coerce.number().int().min(1000).max(30000).default(20000),
  STORAGE_PUBLISH_SECONDS: z.coerce.number().int().min(60).default(60),
  STORAGE_HISTORY_HOURLY_DAYS: z.coerce.number().int().min(1).max(365).default(90),
  STORAGE_HISTORY_DAILY_MONTHS: z.coerce.number().int().min(12).max(120).default(24),
  BACKUP_METRICS_DIR: z.string().optional(),
  LOG_METRICS_DIR: z.string().optional(),
  REDIS_METRICS_DIR: z.string().optional(),
  INFRA_METRICS_FILE: z.string().optional(),
});
export type WorkerEnv = z.infer<typeof envSchema>;
export function readEnv(): WorkerEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Configuração inválida: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  return parsed.data;
}
