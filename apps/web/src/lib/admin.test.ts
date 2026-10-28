import { it, expect } from 'vitest';
import { administrativeSections } from './admin';
import { groupMailboxesByDomain } from './mailbox-groups';
it('limits administrative navigation to the delegated permissions', () => {
  expect(
    administrativeSections({ role: 'member', access_permissions: ['audit.view'] }).map(
      (v) => v.path,
    ),
  ).toEqual(['/admin/audit']);
  expect(administrativeSections({ role: 'member', access_permissions: [] })).toHaveLength(0);
});
it('groups only supplied mailboxes by full hostname without alias duplication', () => {
  const boxes = [
    { id: 'a', name: 'Financeiro', email_address: 'a@example.com', aliases: ['a@other.com'] },
    { id: 'b', name: 'Comercial', email_address: 'b@gmail.com', aliases: [] },
    { id: 'c', name: 'Filial', email_address: 'c@sub.example.com', aliases: [] },
  ];
  expect(groupMailboxesByDomain(boxes).map((v) => v.domain)).toEqual([
    'example.com',
    'gmail.com',
    'sub.example.com',
  ]);
});
