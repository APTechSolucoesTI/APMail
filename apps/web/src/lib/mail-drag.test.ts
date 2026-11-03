import { expect, it } from 'vitest';
import {
  reorderIds,
  readMailDrag,
  writeMailDrag,
  MAIL_DRAG_TYPE,
  selectionAfterMove,
  mergeSubsetOrder,
  orderedSiblingItems,
} from './mail-drag';
it('reorders only existing siblings and never adds or nests an identifier', () => {
  expect(reorderIds(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
  expect(reorderIds(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
  expect(reorderIds(['a', 'b'], 'child', 'a')).toEqual(['a', 'b']);
});
it('keeps other domains in place when reordering mailboxes inside a domain', () => {
  expect(mergeSubsetOrder(['a', 'x', 'b', 'y'], ['b', 'a'])).toEqual(['b', 'x', 'a', 'y']);
});
it('orders promoted roots only against folders that have the same actual parent', () => {
  const items = [
    { id: 'a', parent_id: null },
    { id: 'x', parent_id: 'hidden' },
    { id: 'b', parent_id: null },
    { id: 'y', parent_id: 'hidden' },
  ];
  expect(
    orderedSiblingItems(items, 'box', { 'box:root': ['b', 'a'], 'box:hidden': ['y', 'x'] }).map(
      (item) => item.id,
    ),
  ).toEqual(['b', 'y', 'a', 'x']);
});
it('clears only successfully moved rows from a selection, including individual messages', () => {
  const moved = { kind: 'messages' as const, mailboxId: 'box', threadIds: ['t1'], messageIds: [] };
  expect(
    selectionAfterMove(['m1', 'm2'], moved, [
      { id: 't1', message_id: 'm1' },
      { id: 't2', message_id: 'm2' },
    ]),
  ).toEqual(['m2']);
  expect(
    selectionAfterMove(['m1', 'm2'], { ...moved, threadIds: [], messageIds: ['m2'] }, []),
  ).toEqual(['m1']);
});
it('accepts only validated APMail drag payloads and keeps external text private', () => {
  const data = new Map<string, string>();
  const transfer = {
    setData: (key: string, value: string) => data.set(key, value),
    getData: (key: string) => data.get(key) ?? '',
    effectAllowed: 'none',
  } as unknown as DataTransfer;
  writeMailDrag(transfer, { kind: 'messages', mailboxId: 'box', threadIds: ['t'], messageIds: [] });
  expect(readMailDrag(transfer)).toMatchObject({ kind: 'messages', threadIds: ['t'] });
  expect(data.has('text/plain')).toBe(false);
  data.set(
    MAIL_DRAG_TYPE,
    JSON.stringify({ kind: 'messages', mailboxId: 'box', threadIds: [], messageIds: [] }),
  );
  expect(readMailDrag(transfer)).toBeNull();
  data.set(MAIL_DRAG_TYPE, 'broken');
  expect(readMailDrag(transfer)).toBeNull();
});
