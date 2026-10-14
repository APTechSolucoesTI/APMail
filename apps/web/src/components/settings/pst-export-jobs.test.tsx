import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import type { PstExportTask } from '@apmail/shared';
import { PstExportJobs, pstExportQueryKey } from './pst-export-jobs';
import { api } from '@/lib/api';
vi.mock('@/lib/auth', () => ({ useTenantId: () => 'tenant', useUserId: () => 'user' }));
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
const sample: PstExportTask = {
  id: 'task',
  filename: 'conta.pst',
  state: 'ready',
  total_messages: 100,
  prepared: 100,
  converted: 100,
  warnings: 0,
  last_error: null,
  created_at: '2026-10-14T09:00:00Z',
  expires_at: '2099-10-15T09:00:00Z',
  files: [
    { id: 'part1', filename: 'conta-parte-1.pst', size_bytes: '1024' },
    { id: 'part2', filename: 'conta-parte-2.pst', size_bytes: '1024' },
  ],
};
function show(task: PstExportTask) {
  const client = new QueryClient({
    defaultOptions: { queries: { staleTime: Infinity, retry: false } },
  });
  client.setQueryData(pstExportQueryKey('tenant', 'user', 'box'), [task]);
  return render(
    <QueryClientProvider client={client}>
      <PstExportJobs mailboxId="box" />
    </QueryClientProvider>,
  );
}
beforeEach(() => vi.mocked(api).mockReset());
it('exibe cada parte com download protegido da caixa e a validade do backup', () => {
  show(sample);
  expect(screen.getByText('Pronto para baixar')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Baixar conta-parte-1.pst' })).toHaveAttribute(
    'href',
    '/api/mailboxes/box/archive-exports/task/files/part1',
  );
  expect(screen.getByRole('link', { name: 'Baixar conta-parte-2.pst' })).toBeInTheDocument();
  expect(screen.getByText(/baixe todos os arquivos PST/)).toBeInTheDocument();
});
it('oculta downloads expirados e não oferece retomada de arquivos indisponíveis', () => {
  show({ ...sample, expires_at: '2000-01-01T00:00:00Z' });
  expect(screen.getByText('Expirado')).toBeInTheDocument();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Tentar novamente' })).not.toBeInTheDocument();
});
it('mostra progresso persistido e não libera download durante a geração', () => {
  show({ ...sample, state: 'converting', converted: 42 });
  expect(screen.getByRole('status')).toHaveTextContent('42 de 100');
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '42');
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});
it('retoma a mesma tarefa após uma falha e atualiza a listagem', async () => {
  vi.mocked(api).mockResolvedValue([sample]);
  show({ ...sample, state: 'failed', last_error: 'Falha temporária' });
  await userEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(api).toHaveBeenCalledWith('/mailboxes/box/archive-exports/task/resume', {
    method: 'POST',
  });
  await waitFor(() => expect(screen.getByText('Pronto para baixar')).toBeInTheDocument());
});
