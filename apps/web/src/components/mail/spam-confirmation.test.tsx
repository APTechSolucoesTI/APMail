import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { SpamConfirmation } from './spam-confirmation';
import { api } from '@/lib/api';
vi.mock('@/lib/api', () => ({ api: vi.fn().mockResolvedValue({}) }));
function Wrapper() {
  const [open, setOpen] = useState(true);
  return (
    <QueryClientProvider client={new QueryClient()}>
      <button onClick={() => setOpen(true)}>Reabrir</button>
      {open && (
        <SpamConfirmation
          mailboxId="box"
          messageIds={['message', 'older']}
          sender="ana@example.com"
          onClose={() => setOpen(false)}
        />
      )}
    </QueryClientProvider>
  );
}
beforeEach(() => {
  vi.mocked(api).mockReset().mockResolvedValue({});
});
it('explica o filtro de remetente, cancela sem efeitos e confirma as mensagens selecionadas', async () => {
  render(<Wrapper />);
  expect(screen.getByRole('alertdialog')).toHaveTextContent('ana@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reabrir' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/mailboxes/box/messages/actions', {
      method: 'POST',
      body: { type: 'spam', message_ids: ['message', 'older'] },
    }),
  );
});
it('mantém erro visível sem fechar a confirmação e permite tentar novamente', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('Aguarde a alteração anterior terminar.'));
  render(<Wrapper />);
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Aguarde a alteração anterior terminar.',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  expect(api).toHaveBeenCalledTimes(2);
});
