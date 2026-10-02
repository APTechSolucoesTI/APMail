import { z } from 'zod';
export const QUEUE_REASONS = [
  'inbound',
  'outbound',
  'manual',
  'assignment',
  'schedule',
  'rule',
  'sync',
] as const;
export type QueueReason = (typeof QUEUE_REASONS)[number];
export type ThreadQueueStatus =
  'none' | 'to_reply' | 'in_progress' | 'awaiting_reply' | 'scheduled' | 'done';
export function computeThreadStatus(t: {
  queue_excluded: boolean;
  has_pending_outbox: boolean;
  manual_done_at: Date | null;
  last_inbound_at: Date | null;
  last_outbound_at: Date | null;
  assigned_to: string | null;
  history_queue_eligible?: boolean;
}): ThreadQueueStatus {
  if (t.queue_excluded) return 'none';
  if (t.has_pending_outbox) return 'scheduled';
  if (t.manual_done_at && (!t.last_inbound_at || t.last_inbound_at <= t.manual_done_at))
    return 'done';
  if (t.history_queue_eligible === false && !t.assigned_to) return 'none';
  if (t.last_inbound_at && (!t.last_outbound_at || t.last_inbound_at > t.last_outbound_at))
    return t.assigned_to ? 'in_progress' : 'to_reply';
  if (t.last_outbound_at) return 'awaiting_reply';
  return 'none';
}
export const threadNoteSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  mentioned_user_ids: z.array(z.uuid()).max(100).default([]),
});
export const threadAssigneeSchema = z.object({ user_id: z.uuid().nullable() });
export function noteMentions(
  body: string,
): { user_id: string; full_name: string; index: number; text: string }[] {
  return [...body.matchAll(/@\[([^\]\r\n]{1,200})\]\(([0-9a-f-]{36})\)/gi)]
    .filter((m) => z.uuid().safeParse(m[2]).success)
    .map((m) => ({ user_id: m[2]!, full_name: m[1]!, index: m.index, text: m[0] }));
}
