import { loadRootEnv, resolveWorkspacePath } from '@apmail/db';
import { z } from 'zod';
loadRootEnv();
const key = z
  .string()
  .refine(
    (value) => Buffer.from(value, 'base64').length === 32,
    'A chave precisa decodificar para 32 bytes.',
  );
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.url(),
  TZ: z.string().default('America/Sao_Paulo'),
  LOG_LEVEL: z.string().default('info'),
  DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  SESSION_SECRET: key,
  CREDENTIALS_ENCRYPTION_KEY: key,
  SESSION_TTL_DAYS: z.coerce.number().int().min(1).default(30),
  ALLOW_PUBLIC_SIGNUP: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3001),
  STORAGE_DIR: z.string().default('./.data/storage').transform(resolveWorkspacePath),
  MAX_UPLOAD_MB: z.coerce.number().min(1).max(25).default(25),
  ALLOW_INSECURE_TLS_HOSTS: z.string().default(''),
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
