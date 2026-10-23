import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { calendarEventSchema, meetPreferencesSchema } from '@apmail/shared';
import { api } from '@/lib/api';
import { EventEditor } from './event-editor';
import type { CalendarEvent } from '@/lib/calendar';

vi.mock('@/lib/api', () => ({ api: vi.fn() }));
const event: CalendarEvent = {
  ...calendarEventSchema.parse({
    calendar_id: '10000000-0000-4000-8000-000000000001',
    mailbox_id: '10000000-0000-4000-8000-000000000002',
    title: 'Série QA',
    starts_at: '2030-10-15T17:00:00.000Z',
    ends_at: '2030-10-15T18:00:00.000Z',
    timezone: 'America/Sao_Paulo',
    attendees: [{ address: 'guest@qa.example', name: 'Convidado' }],
    rrule: 'FREQ=DAILY;COUNT=3',
  }),
  id: '10000000-0000-4000-8000-000000000003',
  uid: 'qa@calendar.example',
  organizer: 'owner@qa.example',
  sequence: 0,
  external: false,
  status: 'confirmed',
};
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/mailboxes') return [];
    if (path === '/integrations/google') return { preferences: meetPreferencesSchema.parse({}) };
    if (path === '/calendar/email-preferences') return { mailbox_id: null };
    return event;
  });
});
it.each([false, true])(
  'envia a preferência de atualização ao editar ocorrência: %s',
  async (send) => {
    const onClose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <EventEditor
          event={event}
          calendars={[
            {
              id: event.calendar_id,
              name: 'Pessoal',
              color: '#1686A7',
              timezone: event.timezone,
            },
          ]}
          start={event.starts_at}
          end={event.ends_at}
          original={event.starts_at}
          timezone={event.timezone}
          onClose={onClose}
        />
      </QueryClientProvider>,
    );
    expect(screen.getByRole('combobox', { name: 'Alterar' })).toHaveValue('occurrence');
    if (!send)
      fireEvent.click(
        screen.getByRole('checkbox', { name: 'Enviar atualização aos participantes' }),
      );
    fireEvent.click(screen.getByRole('button', { name: send ? 'Enviar atualização' : 'Salvar' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith('/calendar/events/' + event.id + '/occurrence', {
      method: 'POST',
      body: {
        original: event.starts_at,
        start: event.starts_at,
        end: event.ends_at,
        title: event.title,
        cancelled: false,
        version: 0,
        send_invitations: send,
      },
    });
  },
);
