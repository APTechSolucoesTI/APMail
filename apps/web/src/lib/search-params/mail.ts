import { z } from 'zod';
export const mailSearchSchema = z.object({
  view: z.enum(['folder', 'queue', 'label', 'search']).default('folder'),
  folderId: z.uuid().optional(),
  queue: z
    .enum(['to_reply', 'in_progress', 'awaiting_reply', 'scheduled', 'done', 'overdue'])
    .optional(),
  labelId: z.uuid().optional(),
  q: z.string().max(200).optional(),
  unread: z.boolean().optional(),
  assigned: z.enum(['any', 'me', 'unassigned']).default('any'),
  sort: z.enum(['recent', 'oldest', 'waiting_longest']).default('recent'),
  page: z.number().int().min(1).default(1),
  pageSize: z
    .union([z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100)])
    .default(50),
  thread: z.uuid().optional(),
  compose: z.string().optional(),
});
export type MailSearch = z.infer<typeof mailSearchSchema>;
