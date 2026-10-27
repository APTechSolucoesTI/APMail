import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';
import { MessageSpamAction } from './message-spam-action';
import { api } from '@/lib/api';
const grants = vi.hoisted(() => new Set(['mail.move', 'rules']));
vi.mock('@/lib/auth', () => ({ useAccess: (key: string) => grants.has(key) }));
vi.mock('@/lib/api', () => ({ api: vi.fn().mockResolvedValue({}) }));
const setup = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MessageSpamAction mailboxId="box" messageId="message" sender="ana@example.com" />
    </QueryClientProvider>,
  );
beforeEach(() => {
  grants.add('mail.move');
  grants.add('rules');
  vi.mocked(api).mockReset().mockResolvedValue({});
});
async function open() {
  fireEvent.keyDown(screen.getByRole('button', { name: 'Mais ações da mensagem' }), {
    key: 'Enter',
  });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Marcar como spam' }));
  await screen.findByRole('alertdialog');
}
it('explica a regra, cancela sem efeitos e confirma somente a mensagem escolhida', async () => {
  setup();
  await open();
  expect(screen.getByText(/próximos e-mails de ana@example.com/)).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
  expect(api).not.toHaveBeenCalled();
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/mailboxes/box/messages/actions', {
      method: 'POST',
      body: { type: 'spam', message_ids: ['message'] },
    }),
  );
});
it('mantém erro visível sem fechar a confirmação e permite nova tentativa', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('Aguarde a alteração anterior terminar.'));
  setup();
  await open();
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Aguarde a alteração anterior terminar.',
  );
  expect(screen.getByRole('alertdialog')).toBeVisible();
});
it('não oferece criação de regra sem permissão', () => {
  grants.delete('rules');
  setup();
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
