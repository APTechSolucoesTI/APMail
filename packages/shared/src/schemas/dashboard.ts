import { z } from 'zod';
export const dashboardQuerySchema = z.object({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  mailbox_id: z.uuid().optional(),
  user_id: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const dashboardSearchSchema = z.object({
  period: z.enum(['7', '30', '90', 'custom']).default('30'),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  mailboxId: z.uuid().optional(),
  userId: z.uuid().optional(),
});
export type DashboardKpis = {
  received: number;
  sent: number;
  sent_via_apmail: number;
  to_reply: number;
  in_progress: number;
  awaiting_reply: number;
  scheduled: number;
  overdue: number;
  avg_first_response_minutes: number | null;
  response_rate: number;
  active_users: number;
};
export type DailyVolume = { day: string; received: number; sent: number };
export type FolderVolume = {
  folder_id: string | null;
  folder_name: string;
  mailbox_name: string;
  received: number;
  sent: number;
};
export type DashboardQueue = {
  status: 'to_reply' | 'in_progress' | 'awaiting_reply' | 'scheduled' | 'done';
  count: number;
};
export type UserProductivity = {
  user_id: string;
  full_name: string;
  avatar_url: string | null;
  sent: number;
  threads_replied: number;
  avg_reply_minutes: number | null;
  open_assigned: number;
  done_in_period: number;
};
export type StaleThread = {
  thread_id: string;
  mailbox_id: string;
  mailbox_name: string;
  subject: string;
  queue_status: 'to_reply' | 'in_progress';
  assigned_name: string | null;
  last_inbound_at: string;
  waiting_minutes: number;
  is_overdue: boolean;
};
