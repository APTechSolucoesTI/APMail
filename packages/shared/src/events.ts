export type ServerEvents = {
  'threads:changed': { mailbox_id: string; thread_ids: string[] };
  'queue-counts:changed': { mailbox_id: string };
  'thread:messages-changed': { thread_id: string };
  'thread:notes-changed': { thread_id: string };
  'thread:presence': {
    thread_id: string;
    users: { user_id: string; full_name: string; composing: boolean }[];
  };
  'outbox:changed': {
    outbox_id: string;
    mailbox_id: string;
    thread_id: string | null;
    status: string;
  };
  'mailbox:status': { mailbox_id: string; status: string; last_error: string | null };
  'folders:changed': { mailbox_id: string };
  'mailboxes:changed': Record<string, never>;
  'notification:new': { notification: Record<string, unknown> };
  'chat:message': { conversation_id: string; message: Record<string, unknown> };
  'chat:message-updated': { conversation_id: string; message: Record<string, unknown> };
  'chat:typing': { conversation_id: string; user_id: string; full_name: string };
  'chat:conversations-changed': Record<string, never>;
  'presence:changed': { online_user_ids: string[] };
};
