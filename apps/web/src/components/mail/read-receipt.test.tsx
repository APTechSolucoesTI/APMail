import { it, expect, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { api } from '@/lib/api';
import type { Message } from '@/lib/mail';
import { ReadReceipt } from './read-receipt';
vi.mock('@/lib/api', () => ({ api: vi.fn() }));
beforeEach(() => {
  vi.mocked(api).mockReset();
});
const message = {
  id: 'message',
  direction: 'inbound',
  mdn_request: {
    to: 'sender@example.com',
    recipient: 'receiver@example.com',
    original_message_id: '<original@example.com>',
    return_path_matches: true,
  },
} as Message;
function open(value = message) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReadReceipt message={value} canSend />
    </QueryClientProvider>,
  );
}
it('mostrar o pedido não envia nada; decisão só é registrada ao clicar', async () => {
  vi.mocked(api).mockResolvedValue({ decision: 'confirm' });
  open();
  expect(api).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar leitura' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/messages/message/read-receipt', {
      method: 'POST',
      body: { decision: 'confirm' },
    }),
  );
});
it('recusa não envia confirmação e decisão persistida remove as ações', async () => {
  vi.mocked(api).mockResolvedValue({ decision: 'decline' });
  const view = open();
  fireEvent.click(screen.getByRole('button', { name: 'Não confirmar' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/messages/message/read-receipt', {
      method: 'POST',
      body: { decision: 'decline' },
    }),
  );
  view.unmount();
  open({ ...message, mdn_decision: { decision: 'decline', status: null, last_error: null } });
  expect(screen.queryByRole('button', { name: 'Confirmar leitura' })).not.toBeInTheDocument();
  expect(screen.getByText('Você optou por não confirmar a leitura.')).toBeVisible();
});
it('aguardar MDN não é apresentado como mensagem não lida; apenas displayed confirma', () => {
  open({
    ...message,
    direction: 'outbound',
    request_read_receipt: true,
    read_receipts: [
      {
        recipient_address: 'a@example.com',
        disposition: 'processed',
        received_at: new Date().toISOString(),
        reported_at: null,
      },
    ],
  });
  expect(screen.getByText('Confirmação solicitada · Aguardando confirmação')).toBeVisible();
  expect(screen.getByText(/ausência de resposta não indica/)).toBeVisible();
  expect(screen.queryByText('Leitura confirmada')).not.toBeInTheDocument();
});
