import { beforeEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AntivirusPanel } from './antivirus-panel';
import { api } from '@/lib/api';
import { meQuery } from '@/lib/auth';
import type { ListQuery } from '@apmail/shared';
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('@/components/data/configurable-table', () => ({
  ConfigurableTable: () => <div>Lista de arquivos</div>,
}));
const query: ListQuery = { page: 1, pageSize: 10, search: '', filters: {} };
function open(role = 'admin') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  client.setQueryData(meQuery.queryKey, {
    user: { id: 'u' },
    current_tenant_id: 't',
    tenants: [{ id: 't', role }],
    preferences: { timezone: 'America/Sao_Paulo' },
  });
  return render(
    <QueryClientProvider client={client}>
      <AntivirusPanel query={query} />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith('/overview')
      ? {
          health: {
            status: 'online',
            engine_version: 'ClamAV 1.5',
            signature_version: '123',
            definitions_at: '2026-10-26T10:00:00Z',
            checked_at: '2026-10-26T11:00:00Z',
            stale: false,
            age_hours: 1,
            error_code: null,
          },
          counts: { total: 2, pending: 1, clean: 1, infected: 0, error: 0 },
        }
      : { items: [], total: 0 },
  );
});
it('loads health and history without automatically scheduling scans', async () => {
  open();
  expect(await screen.findByText('ClamAV 1.5')).toBeVisible();
  expect(
    vi.mocked(api).mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Histórico' }));
  await waitFor(() =>
    expect(
      vi.mocked(api).mock.calls.some(([path]) => path.startsWith('/security/antivirus/history?')),
    ).toBe(true),
  );
});
it('denies nonadmins and does not load tenant security data', () => {
  open('member');
  expect(screen.getByText('Sem permissão')).toBeVisible();
  expect(api).not.toHaveBeenCalled();
});
it('asks for confirmation before bounded backfill', async () => {
  open();
  await screen.findByText('ClamAV 1.5');
  fireEvent.click(screen.getByRole('button', { name: 'Verificar pendentes' }));
  expect(await screen.findByRole('alertdialog')).toBeVisible();
  expect(vi.mocked(api).mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
});
