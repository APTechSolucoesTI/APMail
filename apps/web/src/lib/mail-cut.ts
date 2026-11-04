import { useSyncExternalStore } from 'react';
import { api } from './api';
import { MAIL_MOVED_EVENT, type MessageDrag } from './mail-drag';

export type CutMail = {
  tenantId: string;
  userId: string;
  mailboxId: string;
  threadId: string;
  messageId?: string;
  messages: { id: string; folderId: string | null }[];
};
let current: CutMail | null = null;
let pasting = false;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
export function useCutMail(tenantId: string | null, userId: string | undefined) {
  const cut = useSyncExternalStore(
    subscribe,
    () => current,
    () => null,
  );
  const busy = useSyncExternalStore(
    subscribe,
    () => pasting,
    () => false,
  );
  return {
    cut: cut?.tenantId === tenantId && cut.userId === userId ? cut : null,
    busy,
  };
}
export function cutMail(mail: CutMail) {
  current = { ...mail, messages: mail.messages.map((message) => ({ ...message })) };
  changed();
}
export async function pasteCutMail(
  tenantId: string,
  userId: string,
  mailboxId: string,
  folderId: string,
) {
  const cut = current;
  if (pasting || !cut || cut.tenantId !== tenantId || cut.userId !== userId) return false;
  const messages = cut.messages.filter(
    (message) => cut.mailboxId !== mailboxId || message.folderId !== folderId,
  );
  if (!messages.length) return false;
  pasting = true;
  changed();
  try {
    await api('/mailboxes/' + cut.mailboxId + '/messages/actions', {
      method: 'POST',
      body: {
        type: 'move',
        message_ids: messages.map((message) => message.id),
        target_folder_id: folderId,
        target_mailbox_id: mailboxId,
      },
    });
    if (current === cut) current = null;
    const detail: MessageDrag = {
      kind: 'messages',
      mailboxId: cut.mailboxId,
      threadIds: cut.messageId ? [] : [cut.threadId],
      messageIds: messages.map((message) => message.id),
    };
    window.dispatchEvent(new CustomEvent(MAIL_MOVED_EVENT, { detail }));
    return true;
  } finally {
    pasting = false;
    changed();
  }
}
