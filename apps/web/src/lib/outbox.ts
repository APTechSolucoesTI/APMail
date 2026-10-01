import type { OutboxInput } from '@apmail/shared';
export type Signature = {
  id: string;
  name: string;
  mailbox_id: string | null;
  body_html: string;
  is_default: boolean;
};
export type Outbox = OutboxInput & {
  id: string;
  status: 'draft' | 'queued' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'canceled';
  scheduled_at: string | null;
  send_after: string | null;
  updated_at: string;
  attempts: number;
  last_error: string | null;
  created_by: string | { id: string; full_name: string };
  can_edit: boolean;
  can_cancel: boolean;
  mailbox?: { id: string; name: string };
  attachment_metadata?: { id: string; filename: string; size_bytes: number; source: string }[];
};
