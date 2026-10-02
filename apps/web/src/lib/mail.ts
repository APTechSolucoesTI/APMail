import type { Address, MailboxRole } from '@apmail/shared';
import type { PersonalLabel } from './organization';
export type Folder = {
  id: string;
  name: string;
  parent_id: string | null;
  special_use: string | null;
  imap_path?: string;
  special_use_official?: boolean;
  unread_count: number;
  children: Folder[];
};
export type Thread = {
  id: string;
  subject: string;
  snippet: string;
  participants: string[];
  message_count: number;
  has_attachments: boolean;
  last_message_at: string | null;
  last_inbound_at: string | null;
  queue_status: 'none' | 'to_reply' | 'in_progress' | 'awaiting_reply' | 'scheduled' | 'done';
  queue_excluded?: boolean;
  is_unread: boolean;
  is_pinned: boolean;
  labels: PersonalLabel[];
  assigned_to: { id: string; full_name: string; avatar_url: string | null } | null;
  is_overdue: boolean;
  has_scheduled: boolean;
  latest_from: { name: string; address: string };
};
export type Attachment = {
  id: string;
  filename: string;
  content_type: string;
  size_bytes: number;
  content_id: string | null;
  is_inline: boolean;
};
export type Message = {
  id: string;
  folder_id: string | null;
  subject: string;
  from_address: string;
  from_name: string;
  to_addresses: Address[];
  cc_addresses: Address[];
  reply_to_addresses: Address[];
  message_at: string;
  snippet: string;
  body_html: string | null;
  body_text: string;
  is_flagged: boolean;
  pending_action: boolean;
  attachments: Attachment[];
  sent_by: { id: string; full_name: string } | null;
};
export type ThreadDetail = {
  labels: PersonalLabel[];
  thread: Thread;
  messages: Message[];
  cid_map: Record<string, string>;
  is_pinned: boolean;
  last_read_at: string | null;
  my_role: MailboxRole;
  pending_outbox: {
    id: string;
    status: string;
    scheduled_at: string | null;
    created_by: string;
    created_by_name: string;
  }[];
};
export const folderLabel = (f: Folder) =>
  f.special_use === 'junk' && !f.special_use_official
    ? `Spam (${f.imap_path ?? f.name})`
    : ({
        inbox: 'Caixa de entrada',
        sent: 'Enviados',
        drafts: 'Rascunhos',
        archive: 'Arquivo',
        junk: 'Spam',
        trash: 'Lixeira',
      }[f.special_use ?? ''] ?? f.name);
export const flattenFolders = (folders: Folder[]): Folder[] =>
  folders.flatMap((f) => [f, ...flattenFolders(f.children)]);
