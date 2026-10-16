import { it, expect } from 'vitest';
import { calendarInviteSchema } from '@apmail/shared';
import { calendarEmailHtml } from './calendar-email.js';

const invite = calendarInviteSchema.parse({
  method: 'REQUEST',
  uid: 'test@example.com',
  sequence: 0,
  title: '<Revisão>',
  description: '',
  location: 'Sala 1',
  organizer: 'organizer@example.com',
  attendees: [{ address: 'guest@example.com' }],
  starts_at: '2030-10-15T17:00:00.000Z',
  ends_at: '2030-10-15T18:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  all_day: false,
  rrule: null,
  timezone_definition: null,
});
it('gera um convite completo sem exigir texto por reunião e escapa o modelo', () => {
  const html = calendarEmailHtml(invite);
  expect(html).toContain('Você está convidado(a) para &lt;Revisão&gt;');
  expect(html).toContain('Sala 1');
  expect(html).toContain('14:00');
  const custom = calendarEmailHtml(
    invite,
    'Olá <script>alert(1)</script>\n{{titulo}} · {{organizador}}',
  );
  expect(custom).not.toContain('<script>');
  expect(custom).toContain('&lt;script&gt;');
  expect(custom).toContain('&lt;Revisão&gt; · organizer@example.com');
});
it('não apresenta mensagem de convite em cancelamentos ou respostas', () => {
  for (const method of ['CANCEL', 'REPLY'] as const) {
    const html = calendarEmailHtml({ ...invite, method }, 'Texto personalizado de convite');
    expect(html).not.toContain('Texto personalizado de convite');
    expect(html).toContain(method === 'CANCEL' ? 'Reunião cancelada' : 'Resposta ao convite');
  }
});
