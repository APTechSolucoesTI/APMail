import { it, expect } from 'vitest';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { simpleParser } from 'mailparser';
import {
  buildCalendarInvite,
  calendarInviteSchema,
  parseCalendarInvite,
  calendarOccurrences,
} from '@apmail/shared';
import { readCalendarInvite } from '../src/lib/calendar.js';
const invite = calendarInviteSchema.parse({
  method: 'REQUEST',
  uid: 'qa-meeting@example.com',
  sequence: 1,
  title: 'Reunião de produto',
  description: 'Pauta',
  location: 'Sala 2',
  organizer: 'organizer@example.com',
  attendees: [{ address: 'recipient@example.com', name: 'Pessoa' }],
  starts_at: '2026-10-16T13:00:00.000Z',
  ends_at: '2026-10-16T14:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  all_day: false,
  rrule: null,
});
it.each(['REQUEST', 'CANCEL', 'REPLY'] as const)(
  'produz MIME text/calendar interoperável com METHOD %s',
  async (method) => {
    const value = {
      ...invite,
      method,
      attendees:
        method === 'REPLY'
          ? [{ address: 'recipient@example.com', name: 'Pessoa', status: 'ACCEPTED' as const }]
          : invite.attendees,
    };
    const raw = await new MailComposer({
      from: method === 'REPLY' ? 'recipient@example.com' : invite.organizer,
      to: method === 'REPLY' ? invite.organizer : 'recipient@example.com',
      subject: invite.title,
      text: 'Convite de reunião',
      icalEvent: { method, content: buildCalendarInvite(value) },
    })
      .compile()
      .build();
    expect(raw.toString()).toMatch(new RegExp('text/calendar;[^\r]*method=' + method, 'i'));
    const parsed = await simpleParser(raw),
      sender = method === 'REPLY' ? 'recipient@example.com' : invite.organizer,
      own = method === 'REPLY' ? [invite.organizer] : ['recipient@example.com'];
    expect(readCalendarInvite(parsed, sender, own)).toMatchObject({
      method,
      uid: invite.uid,
      sequence: 1,
    });
    expect(readCalendarInvite(parsed, 'forged@example.com', own)).toBeNull();
  },
);
it('preserva uma série em horário local ao exportar e importar, incluindo DST', () => {
  const value = {
    ...invite,
    starts_at: '2026-10-31T13:00:00.000Z',
    ends_at: '2026-10-31T14:00:00.000Z',
    timezone: 'America/New_York',
    rrule: 'FREQ=DAILY;COUNT=4',
  };
  const raw = buildCalendarInvite(value);
  expect(raw).toContain('BEGIN:VTIMEZONE');
  expect(raw).toContain('TZID=America/New_York');
  const imported = parseCalendarInvite(raw)!;
  expect(
    calendarOccurrences(imported, new Date('2026-10-31Z'), new Date('2026-11-04Z')).map(
      (v) => v.start,
    ),
  ).toEqual([
    '2026-10-31T13:00:00.000Z',
    '2026-11-01T14:00:00.000Z',
    '2026-11-02T14:00:00.000Z',
    '2026-11-03T14:00:00.000Z',
  ]);
});
