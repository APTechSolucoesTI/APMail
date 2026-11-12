import { expect, it } from 'vitest';
import { mailboxSyncSearch } from '../src/imap/sync-search.js';

it('busca todo o histórico sem restrição de data', () => {
  expect(mailboxSyncSearch(0, null)).toEqual({ all: true });
});

it('aplica o corte de data durante a primeira importação limitada', () => {
  const since = new Date('2016-11-12T00:00:00Z');
  expect(mailboxSyncSearch(0, since)).toEqual({ since });
});

it('retoma pelo UID sem reimportar o histórico já processado', () => {
  expect(mailboxSyncSearch(125, null)).toEqual({ uid: '126:*' });
  expect(mailboxSyncSearch(125, new Date())).toEqual({ uid: '126:*' });
});
