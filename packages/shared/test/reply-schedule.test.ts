import { it, expect } from 'vitest';
import {
  replyRecipients,
  replySubject,
  quoteHtml,
  schedulePresets,
  validateSchedule,
  scheduleFromLocal,
  type ReplyMessage,
} from '../src/index.js';
const message: ReplyMessage = {
  from_name: '<Cliente>',
  from_address: 'CLIENTE@example.com',
  reply_to: [],
  to_addresses: [
    { name: 'Equipe', address: 'comercial@example.com' },
    { name: 'Outro', address: 'outro@example.com' },
  ],
  cc_addresses: [{ name: 'Duplicado', address: 'OUTRO@example.com' }],
  subject: 'Pedido <42>',
  body_html: '<p>Olá</p>',
  message_at: '2026-10-01T12:00:00Z',
};
it('responde sem duplicar prefixos ou incluir a própria caixa e deduplica Cc', () => {
  expect(replySubject('Re: Pedido', 'reply')).toBe('Re: Pedido');
  expect(replySubject('Pedido', 'forward')).toBe('Enc: Pedido');
  expect(replyRecipients(message, 'reply_all', ['COMERCIAL@example.com'])).toEqual({
    to_addresses: [
      { name: '<Cliente>', address: 'cliente@example.com' },
      { name: 'Outro', address: 'outro@example.com' },
    ],
    cc_addresses: [],
  });
  expect(replyRecipients(message, 'forward', [])).toEqual({ to_addresses: [], cc_addresses: [] });
  expect(
    replyRecipients(
      { ...message, reply_to: [{ name: 'Suporte', address: 'suporte@example.com' }] },
      'reply',
      [],
    ).to_addresses[0]?.address,
  ).toBe('suporte@example.com');
});
it('cita usando o fuso e escapa cabeçalho original', () => {
  const html = quoteHtml(message, 'reply', 'America/Sao_Paulo');
  expect(html).toContain('01/10/2026 09:00');
  expect(html).toContain('&lt;Cliente&gt;');
  expect(html).toContain('data-apmail-quote');
  expect(quoteHtml(message, 'forward', 'UTC')).toContain('Pedido &lt;42&gt;');
});
it('persiste horários em UTC e respeita limite de cinco minutos e próxima segunda', () => {
  const now = new Date('2026-10-05T16:54:00Z');
  expect(schedulePresets('America/Sao_Paulo', now)[0]?.scheduled_at).toBe(
    '2026-10-05T17:00:00.000Z',
  );
  expect(schedulePresets('America/Sao_Paulo', new Date('2026-10-05T16:55:00Z'))[0]?.label).toBe(
    'Amanhã às 08:00',
  );
  expect(schedulePresets('America/Sao_Paulo', now).at(-1)?.scheduled_at).toBe(
    '2026-10-12T11:00:00.000Z',
  );
  expect(scheduleFromLocal('2026-10-01', '08:00', 'America/Sao_Paulo')).toBe(
    '2026-10-01T11:00:00.000Z',
  );
  expect(() => validateSchedule('2026-10-05T16:58:00Z', now)).toThrow();
  expect(validateSchedule('2026-10-05T16:59:00Z', now).toISOString()).toBe(
    '2026-10-05T16:59:00.000Z',
  );
  expect(() => validateSchedule('2027-10-06T16:54:00Z', now)).toThrow();
});
