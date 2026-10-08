import { z } from 'zod';
z.config(z.locales.ptBR());
export const uuidSchema = z.uuid();
export const emailSchema = z.string().trim().max(254).toLowerCase().pipe(z.email());
export const pageSizeSchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(30),
  z.literal(50),
  z.literal(100),
]);
export const listQuerySchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: pageSizeSchema.default(10),
  search: z.coerce.string().trim().max(200).optional(),
  sort: z.object({ key: z.string(), direction: z.enum(['asc', 'desc']) }).optional(),
  filters: z.record(z.string(), z.array(z.string())).default({}),
});
export type ListQuery = z.infer<typeof listQuerySchema>;
export type ListResult<T> = { items: T[]; total: number; page: number; pageSize: number };
export const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});
export const healthSchema = z.object({
  status: z.enum(['ok', 'error']),
  db: z.enum(['ok', 'error']),
  redis: z.enum(['ok', 'error']),
  version: z.string(),
});
export const healthQueuesSchema = z.object({
  queues: z.record(
    z.string(),
    z.object({
      waiting: z.number().int().min(0),
      active: z.number().int().min(0),
      delayed: z.number().int().min(0),
      failed: z.number().int().min(0),
    }),
  ),
  worker_last_heartbeat: z.iso.datetime().nullable(),
});
