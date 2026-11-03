import { describe, expect, it } from 'vitest';
import { planFolderRelocation, type RelocatableFolder } from '../src/folder-relocation.js';
const folder = (
  id: string,
  path: string,
  parent_id: string | null = null,
  extra: Partial<RelocatableFolder> = {},
): RelocatableFolder => ({
  id,
  name: path.split('.').at(-1)!,
  imap_path: path,
  parent_id,
  delimiter: '.',
  is_local: false,
  special_use: null,
  ...extra,
});
const rows = [
  folder('a', 'A'),
  folder('b', 'A.B', 'a'),
  folder('c', 'A.B.C', 'b'),
  folder('z', 'Z'),
];
describe('explicit folder relocation', () => {
  it('renames imported local children under their existing remote parent while preserving virtual paths', () => {
    const imported = [
      folder('inbox', 'INBOX', null, { special_use: 'inbox', delimiter: '/' }),
      folder('local', 'local/folders/inbox/Projeto', 'inbox', {
        name: 'Projeto',
        is_local: true,
        delimiter: '/',
      }),
      folder('nested', 'local/folders/inbox/Projeto/2026', 'local', {
        name: '2026',
        is_local: true,
        delimiter: '/',
      }),
      folder('other-remote', 'Sent', null, { special_use: 'sent', delimiter: '/' }),
    ];
    expect(
      planFolderRelocation(imported, 'local', { name: 'Clientes', parent_id: 'inbox' }),
    ).toEqual([
      {
        id: 'local',
        name: 'Clientes',
        parent_id: 'inbox',
        imap_path: 'local/folders/inbox/Clientes',
      },
      {
        id: 'nested',
        name: '2026',
        parent_id: 'local',
        imap_path: 'local/folders/inbox/Clientes/2026',
      },
    ]);
    expect(() =>
      planFolderRelocation(imported, 'local', { name: 'Projeto', parent_id: 'other-remote' }),
    ).toThrow(/locais/);
    expect(() =>
      planFolderRelocation(imported, 'other-remote', { name: 'Normal', parent_id: 'local' }),
    ).toThrow();
  });
  it('preserves virtual root namespace when renaming an imported root without moving it', () => {
    expect(
      planFolderRelocation(
        [
          folder('local', 'local/folders/Projeto', null, {
            name: 'Projeto',
            is_local: true,
            delimiter: '/',
          }),
        ],
        'local',
        { name: 'Clientes', parent_id: null },
      ),
    ).toEqual([
      { id: 'local', name: 'Clientes', parent_id: null, imap_path: 'local/folders/Clientes' },
    ]);
  });
  it('preserves descendant IDs/parents and changes paths using the actual delimiter', () => {
    expect(planFolderRelocation(rows, 'a', { name: 'A', parent_id: 'z' })).toEqual([
      { id: 'a', name: 'A', parent_id: 'z', imap_path: 'Z.A' },
      { id: 'b', name: 'B', parent_id: 'a', imap_path: 'Z.A.B' },
      { id: 'c', name: 'C', parent_id: 'b', imap_path: 'Z.A.B.C' },
    ]);
  });
  it('can move a subtree back to root and repeat the same target safely', () => {
    const updates = planFolderRelocation(rows, 'b', { name: 'B', parent_id: null });
    expect(updates[0]).toMatchObject({ parent_id: null, imap_path: 'B' });
    const moved = rows.map((f) => ({ ...f, ...updates.find((u) => u.id === f.id) }));
    expect(planFolderRelocation(moved, 'b', { name: 'B', parent_id: null })).toEqual(updates);
  });
  it.each(['a', 'b', 'c'])('rejects cycles through %s', (parent_id) => {
    expect(() => planFolderRelocation(rows, 'a', { name: 'A', parent_id })).toThrow(/subpasta/);
  });
  it('rejects unavailable parents, special sources, incompatible local/server hierarchy and conflicts', () => {
    expect(() => planFolderRelocation(rows, 'a', { name: 'A', parent_id: 'foreign' })).toThrow(
      /destino/,
    );
    expect(() =>
      planFolderRelocation([folder('s', 'INBOX', null, { special_use: 'inbox' })], 's', {
        name: 'X',
        parent_id: null,
      }),
    ).toThrow(/especia/);
    expect(() =>
      planFolderRelocation([...rows, folder('l', 'Local', null, { is_local: true })], 'a', {
        name: 'A',
        parent_id: 'l',
      }),
    ).toThrow(/locais/);
    expect(() =>
      planFolderRelocation([...rows, folder('conflict', 'Z.A.B')], 'a', {
        name: 'A',
        parent_id: 'z',
      }),
    ).toThrow(/existe/);
  });
  it('rejects a special or incompatible descendant so the whole subtree remains intact', () => {
    expect(() =>
      planFolderRelocation(
        rows.map((f) => (f.id === 'c' ? { ...f, special_use: 'trash' } : f)),
        'a',
        { name: 'A', parent_id: 'z' },
      ),
    ).toThrow(/especia/);
  });
});
