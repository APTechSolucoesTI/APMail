import { loadRootEnv, resolveWorkspacePath, normalizeSmtpHelloName } from '@apmail/db';
import { z } from 'zod';
loadRootEnv();
const key = z
  .string()
  .refine(
    (value) => Buffer.from(value, 'base64').length === 32,
    'A chave precisa decodificar para 32 bytes.',
  );
export const envSchema = z.object({
  CLAMAV_HOST: z.string().trim().max(253).default('apticket-antivirus'),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  CLAMAV_MAX_SCAN_MB: z.coerce.number().int().min(1).max(25).default(25),
  CLAMAV_SCAN_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(30000),
  CLAMAV_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(10000).default(3000),
  CLAMAV_DEFINITIONS_MAX_AGE_HOURS: z.coerce.number().int().min(24).max(168).default(168),
  CLAMAV_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url(),
  SMTP_EHLO_NAME: z
    .string()
    .trim()
    .default('')
    .refine(
      (value) => !value || normalizeSmtpHelloName(value) !== null,
      'Informe um domínio público ou IP público válido, sem protocolo ou porta.',
    ),
  TZ: z.string().default('America/Sao_Paulo'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  SESSION_SECRET: key,
  CREDENTIALS_ENCRYPTION_KEY: key,
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  ALLOW_PUBLIC_SIGNUP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  STORAGE_DIR: z.string().default('./.data/storage').transform(resolveWorkspacePath),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(25).default(25),
  ALLOW_INSECURE_TLS_HOSTS: z.string().default(''),
  DISK_WARNING_PERCENT: z.coerce.number().min(1).max(99).default(80),
  DISK_CRITICAL_PERCENT: z.coerce.number().min(1).max(100).default(90),
  SYNC_DELAY_MINUTES: z.coerce.number().int().positive().default(10),
  WORKER_HEARTBEAT_SECONDS: z.coerce.number().int().positive().default(90),
});
export type ApiEnv = z.infer<typeof envSchema>;
export function readEnv(): ApiEnv {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success)
    throw new Error(
      `Configuração inválida: ${parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  return parsed.data;
}
