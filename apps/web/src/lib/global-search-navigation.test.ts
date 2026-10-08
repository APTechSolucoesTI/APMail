import { expect, it } from 'vitest';
import { searchDestination, uniqueSearchGroups } from './global-search-navigation';

it('preserves mailbox, folder, conversation and draft query when navigating search results', () => {
  expect(searchDestination('/mail/box?view=folder&folderId=folder')).toEqual({
    to: '/mail/box',
    search: { view: 'folder', folderId: 'folder' },
  });
  expect(searchDestination('/mail/box?view=search&q=a%C3%A7%C3%A3o&thread=thread').search).toEqual({
    view: 'search',
    q: 'ação',
    thread: 'thread',
  });
  expect(searchDestination('/mail/box?compose=draft%3Aid').search.compose).toBe('draft:id');
  expect(() => searchDestination('//outside.example/path')).toThrow();
});
it('removes repeated identities while preserving distinct mailboxes with the same name', () => {
  const item = {
    category: 'mailbox' as const,
    id: 'one',
    title: 'Suporte',
    description: 'one@example.com',
    url: '/mail/one',
  };
  const groups = uniqueSearchGroups([
    {
      category: 'mailbox',
      items: [item, item, { ...item, id: 'two', url: '/mail/two' }],
      has_more: false,
    },
  ]);
  expect(groups[0]?.items.map((i) => i.id)).toEqual(['one', 'two']);
});
