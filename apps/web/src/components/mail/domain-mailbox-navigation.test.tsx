import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DomainMailboxNavigation } from './domain-mailbox-navigation';
import { useMailNavigation } from '@/hooks/use-mail-navigation';
import { activeMailDrag, clearMailDrag, writeMailDrag } from '@/lib/mail-drag';
import type { Mailbox } from '@/lib/auth';
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      user: { id: 'user' },
      current_tenant_id: 'tenant',
      preferences: { mail_group_by_domain: true },
    },
  }),
}));
vi.mock('@/lib/auth', () => ({ meQuery: {} }));
vi.mock('@tanstack/react-router', () => ({ useLocation: () => ({ pathname: '/mail/a' }) }));
vi.mock('@/hooks/use-mail-navigation', () => ({ useMailNavigation: vi.fn() }));
vi.mock('./mailbox-reorder', () => ({
  MailboxReorder: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock('./mailbox-folder-navigation', () => ({
  MailboxFolderNavigation: ({ box }: { box: Mailbox }) => (
    <div data-testid={'mailbox-' + box.id}>{box.name}</div>
  ),
}));
const boxes = [
  { id: 'a', name: 'A', email_address: 'a@alpha.test' },
  { id: 'z', name: 'Z', email_address: 'z@zeta.test' },
] as Mailbox[];
function transfer() {
  const values = new Map<string, string>();
  return {
    setData: (k: string, v: string) => values.set(k, v),
    getData: (k: string) => values.get(k) ?? '',
    effectAllowed: '',
    dropEffect: '',
  } as unknown as DataTransfer;
}
function mount(domain_order: string[] = []) {
  const save = vi.fn();
  vi.mocked(useMailNavigation).mockReturnValue({
    save,
    busy: false,
    isLoading: false,
    isError: false,
    config: { mailbox_order: [], domain_order, folder_orders: {}, favorite_folder_ids: [] },
    retry: vi.fn(),
  } as unknown as ReturnType<typeof useMailNavigation>);
  render(<DomainMailboxNavigation boxes={boxes} onNavigate={() => {}} />);
  return save;
}
afterEach(() => {
  cleanup();
  clearMailDrag();
  localStorage.clear();
  vi.clearAllMocks();
});
it('directly drags domain headers, shows insertion feedback and persists domain order', () => {
  const save = mount(),
    dataTransfer = transfer(),
    alpha = screen.getByRole('button', { name: 'alpha.test' }),
    zeta = screen.getByRole('button', { name: 'zeta.test' });
  expect(alpha).toHaveAttribute('draggable', 'true');
  fireEvent.dragStart(alpha, { dataTransfer });
  expect(activeMailDrag()).toEqual({ kind: 'domain', id: 'alpha.test' });
  expect(alpha).toHaveClass('opacity-40');
  fireEvent.dragOver(zeta, { dataTransfer });
  expect(zeta.className).toContain('after:bg-primary');
  fireEvent.drop(zeta, { dataTransfer });
  expect(save).toHaveBeenCalledWith({ type: 'domains', ids: ['zeta.test', 'alpha.test'] });
});
it('applies stored domain order and supports Alt+Arrow while ordinary toggle keeps working', () => {
  const save = mount(['zeta.test', 'alpha.test']);
  expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual([
    'zeta.test',
    'alpha.test',
  ]);
  const alpha = screen.getByRole('button', { name: 'alpha.test' });
  fireEvent.keyDown(alpha, { key: 'ArrowUp', altKey: true });
  expect(save).toHaveBeenCalledWith({ type: 'domains', ids: ['alpha.test', 'zeta.test'] });
  fireEvent.click(alpha);
  expect(alpha).toHaveAttribute('aria-expanded', 'false');
});
it('does not turn nested mailbox or folder drags into domain reorders', () => {
  const save = mount(),
    dataTransfer = transfer();
  writeMailDrag(dataTransfer, { kind: 'mailbox', id: 'a' });
  fireEvent.dragStart(screen.getByTestId('mailbox-a'), { dataTransfer });
  expect(activeMailDrag()).toEqual({ kind: 'mailbox', id: 'a' });
  fireEvent.drop(screen.getByRole('button', { name: 'zeta.test' }), { dataTransfer });
  expect(save).not.toHaveBeenCalled();
  writeMailDrag(dataTransfer, { kind: 'folder', mailboxId: 'a', id: 'folder', parentId: null });
  fireEvent.drop(screen.getByRole('button', { name: 'zeta.test' }), { dataTransfer });
  expect(save).not.toHaveBeenCalled();
});
