import { beforeEach, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { calendarInviteSchema } from '@apmail/shared';
import { api } from '@/lib/api';
import { CalendarInvitation } from './calendar-invite';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
beforeEach(() => vi.mocked(api).mockReset());
const invite = calendarInviteSchema.parse({
  uid: 'meeting@example.com',
  method: 'REQUEST',
  sequence: 0,
  description: '',
  location: '',
  all_day: false,
  rrule: null,
  title: 'Reunião de equipe',
  organizer: 'sender@example.com',
  starts_at: '2030-10-15T17:00:00.000Z',
  ends_at: '2030-10-15T18:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  attendees: [{ address: 'receiver@example.com', name: 'Pessoa convidada' }],
});
function open(canSend = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CalendarInvitation messageId="message" timeZone="America/Sao_Paulo" canSend={canSend} />
    </QueryClientProvider>,
  );
}
it('convite novo oferece aceitar e recusar, sem tentativa nem envio automático', async () => {
  vi.mocked(api).mockResolvedValue({ invite, event: null });
  open();
  expect(await screen.findByRole('button', { name: 'Aceitar' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Recusar' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Tentativa' })).not.toBeInTheDocument();
  expect(api).toHaveBeenCalledTimes(1);
});
it.each(['confirmed', 'cancelled'])(
  'convite já existente (%s) mantém acesso ao calendário sem botões de resposta',
  async (status) => {
    vi.mocked(api).mockResolvedValue({ invite, event: { id: 'event', status } });
    open();
    expect(await screen.findByRole('link', { name: 'Abrir calendário' })).toHaveAttribute(
      'href',
      '/calendar',
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      status === 'confirmed' ? 'Adicionado ao seu calendário.' : 'Evento recusado ou cancelado.',
    );
    expect(
      screen.queryByRole('button', { name: /Aceitar|Recusar|Tentativa/ }),
    ).not.toBeInTheDocument();
    expect(api).toHaveBeenCalledTimes(1);
  },
);
it('aceitar adiciona o evento e substitui as respostas pelo aviso existente', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({ invite, event: null })
    .mockResolvedValueOnce({ id: 'event', status: 'confirmed' })
    .mockResolvedValue({ invite, event: { id: 'event', status: 'confirmed' } });
  open();
  fireEvent.click(await screen.findByRole('button', { name: 'Aceitar' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/messages/message/calendar/respond', {
      method: 'POST',
      body: { status: 'ACCEPTED' },
    }),
  );
  expect(await screen.findByText('Adicionado ao seu calendário.')).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Aceitar' })).not.toBeInTheDocument();
});
it('mantém a restrição de resposta para contas sem permissão de envio', async () => {
  vi.mocked(api).mockResolvedValue({ invite, event: null });
  open(false);
  expect(await screen.findByRole('button', { name: 'Aceitar' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Recusar' })).toBeDisabled();
});
