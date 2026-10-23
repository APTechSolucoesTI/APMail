import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageActions } from './message-actions';
import { api } from '@/lib/api';

const grants = vi.hoisted(() => new Set<string>());
vi.mock('@/lib/auth', () => ({ useAccess: (key: string) => grants.has(key) }));
vi.mock('@/lib/api', () => ({ api: vi.fn().mockResolvedValue({}) }));
function setup(compact = false, flagged: boolean | null = false) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MessageActions
        mailboxId="box"
        folders={[]}
        messageIds={['message']}
        flagged={flagged ?? undefined}
        compact={compact}
      />
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  grants.clear();
  vi.mocked(api).mockClear();
});
describe('MessageActions', () => {
  it('oferece mover sem conceder excluir, restaurar ou sinalizar', () => {
    grants.add('mail.move');
    setup();
    expect(screen.getByRole('button', { name: 'Mover' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restaurar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sinalizar' })).not.toBeInTheDocument();
  });
  it('permite sinalização de forma independente', async () => {
    grants.add('mail.flag');
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'Sinalizar' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith(
        '/mailboxes/box/messages/actions',
        expect.objectContaining({
          method: 'POST',
          body: expect.objectContaining({ type: 'set_flag', flagged: true }),
        }),
      ),
    );
    expect(screen.queryByRole('button', { name: 'Excluir' })).not.toBeInTheDocument();
  });
  it('oculta o menu compacto quando não há ações autorizadas', () => {
    grants.add('mail.organize');
    setup(true);
    expect(screen.queryByRole('button', { name: 'Organizar' })).not.toBeInTheDocument();
  });
  it('não oferece ação de sinalização quando o estado da sinalização é desconhecido', () => {
    grants.add('mail.flag');
    setup(true, null);
    expect(screen.queryByRole('button', { name: 'Organizar' })).not.toBeInTheDocument();
  });
});
