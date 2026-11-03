import { z } from 'zod';
export const MAIL_DRAG_TYPE = 'application/x-apmail';
export const MAIL_MOVED_EVENT = 'apmail:messages-moved';
const identifier = z.string().min(1).max(100);
const schema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('folder'),
    mailboxId: identifier,
    id: identifier,
    parentId: identifier.nullable(),
  }),
  z.object({ kind: z.literal('mailbox'), id: identifier }),
  z
    .object({
      kind: z.literal('messages'),
      mailboxId: identifier,
      threadIds: z.array(identifier).max(500),
      messageIds: z.array(identifier).max(500),
    })
    .refine((v) => v.threadIds.length + v.messageIds.length > 0),
]);
export type MailDrag = z.infer<typeof schema>;
export type MessageDrag = Extract<MailDrag, { kind: 'messages' }>;
export function selectionAfterMove(
  ids: string[],
  moved: MessageDrag,
  items: { id: string; message_id?: string | null }[],
): string[] {
  const removed = new Set([...moved.messageIds, ...moved.threadIds]);
  for (const item of items)
    if (moved.threadIds.includes(item.id)) removed.add(item.message_id ?? item.id);
  return ids.filter((id) => !removed.has(id));
}
let active: MailDrag | null = null;
export const activeMailDrag = () => active;
export const clearMailDrag = () => {
  active = null;
};
export function readMailDrag(transfer: DataTransfer): MailDrag | null {
  try {
    const result = schema.safeParse(JSON.parse(transfer.getData(MAIL_DRAG_TYPE)));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
export function writeMailDrag(transfer: DataTransfer, payload: MailDrag) {
  active = payload;
  transfer.setData(MAIL_DRAG_TYPE, JSON.stringify(payload));
  transfer.effectAllowed = 'move';
}
export function reorderIds(ids: string[], source: string, target: string): string[] {
  const from = ids.indexOf(source),
    to = ids.indexOf(target);
  if (from < 0 || to < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(from, 1);
  next.splice(to, 0, source);
  return next;
}
export function orderedItems<T extends { id: string }>(items: T[], order: string[] = []): T[] {
  const ranks = new Map(order.map((id, i) => [id, i]));
  return [...items].sort((a, b) => (ranks.get(a.id) ?? Infinity) - (ranks.get(b.id) ?? Infinity));
}
export function mergeSubsetOrder(ids: string[], subset: string[]): string[] {
  const included = new Set(subset);
  let index = 0;
  return ids.map((id) => (included.has(id) ? subset[index++]! : id));
}
export function orderedSiblingItems<T extends { id: string; parent_id: string | null }>(
  items: T[],
  mailboxId: string,
  orders: Record<string, string[]>,
): T[] {
  const groups = new Map<string | null, T[]>();
  for (const item of items)
    groups.set(item.parent_id, [...(groups.get(item.parent_id) ?? []), item]);
  const ranks = new Map<string, number>();
  for (const [parent, siblings] of groups)
    orderedItems(siblings, orders[mailboxId + ':' + (parent ?? 'root')]).forEach((item, index) =>
      ranks.set(item.id, index),
    );
  const next = new Map<string | null, number>();
  const sorted = new Map(
    [...groups].map(([parent, siblings]) => [
      parent,
      [...siblings].sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!),
    ]),
  );
  return items.map((item) => {
    const index = next.get(item.parent_id) ?? 0;
    next.set(item.parent_id, index + 1);
    return sorted.get(item.parent_id)![index]!;
  });
}
