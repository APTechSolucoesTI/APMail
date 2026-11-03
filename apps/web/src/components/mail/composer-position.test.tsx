import { beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { DEFAULT_COMPOSITION_FORMAT } from '@apmail/shared';
import { api } from '@/lib/api';
import { meQuery } from '@/lib/auth';
import { Composer } from './composer';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => true }));
vi.mock('@/components/forms/rich-text-editor', () => ({ RichTextEditor: () => <div>Editor</div> }));
beforeEach(() => {
  localStorage.clear();
  Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path) => {
      if (path === '/preferences/composition')
        return { default_format: DEFAULT_COMPOSITION_FORMAT, overrides: [] };
      if (path === '/mailboxes')
        return [
          {
            id: 'box',
            email_address: 'box@example.com',
            aliases: [],
            role: 'editor',
            status: 'active',
          },
        ];
      if (path === '/signatures') return [];
      return { settings: {} };
    });
});
it('permite mover pelo título focável sem precisar de controle de arraste separado', async () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(meQuery.queryKey, {
    user: { id: 'user' },
    current_tenant_id: 'tenant',
    tenants: [{ id: 'tenant', role: 'owner', access_permissions: null }],
    preferences: { timezone: 'America/Sao_Paulo' },
  });
  render(
    <QueryClientProvider client={client}>
      <Composer mailboxId="box" mode="new" onClose={() => {}} onReopen={() => {}} />
    </QueryClientProvider>,
  );
  await screen.findByRole('button', { name: 'Enviar' });
  const title = screen.getByRole('heading', { name: 'Novo e-mail' });
  expect(title).toHaveAttribute('tabindex', '0');
  title.focus();
  fireEvent.keyDown(title, { key: 'ArrowLeft' });
  expect(screen.getByRole('dialog')).toHaveStyle({ left: '444px', top: '124px' });
  expect(screen.queryByRole('button', { name: 'Mover compositor' })).not.toBeInTheDocument();
});
