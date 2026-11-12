import type { SearchObject } from 'imapflow';

export function mailboxSyncSearch(cursor: number, since: Date | null): SearchObject {
  if (cursor) return { uid: `${cursor + 1}:*` };
  return since === null ? { all: true } : { since };
}
