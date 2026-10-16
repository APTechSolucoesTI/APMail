import { describe, it, expect } from 'vitest';
import {
  buildCalendarInvite,
  parseCalendarInvite,
  calendarOccurrences,
  calendarInviteSchema,
  calendarEventSchema,
  rruleSchema,
  resolveCalendarInviteTimezone,
  googleMeetUrl,
  meetingUrlSchema,
} from './calendar.js';
const invite = calendarInviteSchema.parse({
  method: 'REQUEST',
  uid: 'meeting-1@example.com',
  sequence: 2,
  title: 'Revisão, contrato; próximos passos',
  description: 'Primeira linha\nSegunda linha',
  location: 'Sala 1',
  organizer: 'owner@example.com',
  attendees: [{ address: 'guest@example.com', name: 'João da Silva', status: 'NEEDS-ACTION' }],
  starts_at: '2026-10-16T17:00:00.000Z',
  ends_at: '2026-10-16T18:00:00.000Z',
  timezone: 'America/Sao_Paulo',
  all_day: false,
  rrule: null,
});
describe('iCalendar', () => {
  it('transporta Meet, descrição HTML, disponibilidade e convidados opcionais no ICS', () => {
    const value = {
      ...invite,
      meeting_url: 'https://meet.google.com/abc-defg-hij',
      description_html: '<p>Pauta <strong>final</strong></p>',
      availability: 'free' as const,
      attendees: [{ ...invite.attendees[0]!, role: 'optional' as const }],
    };
    const raw = buildCalendarInvite(value),
      parsed = parseCalendarInvite(raw);
    expect(raw).toContain('CONFERENCE;VALUE=URI:https://meet.google.com/abc-defg-hij');
    expect(raw).toContain('ROLE=OPT-PARTICIPANT');
    expect(raw).toContain('TRANSP:TRANSPARENT');
    expect(parsed).toMatchObject({
      meeting_url: value.meeting_url,
      description_html: value.description_html,
      availability: 'free',
      attendees: [{ role: 'optional' }],
    });
    expect(googleMeetUrl('https://meet.google.com/abc-defg-hij?authuser=1')).toBe(
      value.meeting_url,
    );
    expect(googleMeetUrl('https://meet.google.com.evil.example/abc-defg-hij')).toBeNull();
    expect(meetingUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(meetingUrlSchema.safeParse('https://name:password@example.com').success).toBe(false);
  });
  it('mantém DATE e TZID consistentes nas exceções de séries exportadas', () => {
    for (const all_day of [true, false]) {
      const raw = buildCalendarInvite({
        ...invite,
        all_day,
        starts_at: '2026-10-16T03:00:00.000Z',
        ends_at: '2026-10-17T03:00:00.000Z',
        rrule: 'FREQ=DAILY;COUNT=4',
        exceptions: [
          { original: '2026-10-17T03:00:00.000Z', cancelled: true },
          {
            original: '2026-10-18T03:00:00.000Z',
            start: '2026-10-19T03:00:00.000Z',
            end: '2026-10-20T03:00:00.000Z',
            cancelled: false,
            sequence: 3,
            attendees: [{ address: 'guest@example.com', name: 'João', status: 'ACCEPTED' }],
          },
        ],
      });
      expect(raw).toContain(
        all_day ? 'EXDATE;VALUE=DATE:20261017' : 'EXDATE;TZID=America/Sao_Paulo:20261017T000000',
      );
      expect(raw).toContain(
        all_day
          ? 'RECURRENCE-ID;VALUE=DATE:20261018'
          : 'RECURRENCE-ID;TZID=America/Sao_Paulo:20261018T000000',
      );
      expect(raw).not.toMatch(/TZID=[^:]+:[^\r\n]*Z/);
      const parsed = parseCalendarInvite(raw)!;
      expect(parsed).not.toBeNull();
      expect(parsed.exceptions.find((ex) => ex.sequence === 3)?.attendees?.[0]?.status).toBe(
        'ACCEPTED',
      );
    }
  });
  it('rejeita contagem e intervalo zero em recorrências', () => {
    expect(rruleSchema.safeParse('FREQ=DAILY;COUNT=0').success).toBe(false);
    expect(rruleSchema.safeParse('FREQ=DAILY;INTERVAL=0').success).toBe(false);
  });
  it('importa compromissos publicados sem inventar um organizador e preserva privacidade', () => {
    const raw = buildCalendarInvite({
      ...invite,
      method: 'PUBLISH',
      organizer: '',
      is_private: true,
      category: 'Trabalho',
    });
    expect(raw).not.toContain('ORGANIZER:');
    expect(parseCalendarInvite(raw)).toMatchObject({
      method: 'PUBLISH',
      organizer: '',
      is_private: true,
      category: 'Trabalho',
    });
    expect(() => buildCalendarInvite({ ...invite, organizer: '' })).toThrow();
  });
  it('interpreta horários flutuantes no fuso escolhido pelo destinatário', () => {
    const raw = buildCalendarInvite(invite)
      .replace('DTSTART:20261016T170000Z', 'DTSTART:20261016T140000')
      .replace('DTEND:20261016T180000Z', 'DTEND:20261016T150000');
    const parsed = parseCalendarInvite(raw)!;
    expect(parsed.floating).toBe(true);
    expect(resolveCalendarInviteTimezone(parsed, 'America/Sao_Paulo')).toMatchObject({
      starts_at: '2026-10-16T17:00:00.000Z',
      ends_at: '2026-10-16T18:00:00.000Z',
      floating: false,
    });
  });
  it.each(['REQUEST', 'REPLY', 'CANCEL'] as const)(
    'serializa e interpreta %s com UID, sequência e participantes',
    (method) => {
      const parsed = parseCalendarInvite(buildCalendarInvite({ ...invite, method }));
      expect(parsed).toMatchObject({ ...invite, method, timezone: 'UTC' });
    },
  );
  it('preserva eventos de dia inteiro com DTEND exclusivo', () => {
    const raw = buildCalendarInvite({
      ...invite,
      all_day: true,
      starts_at: '2026-10-16T03:00:00.000Z',
      ends_at: '2026-10-18T03:00:00.000Z',
    });
    expect(raw).toContain('DTSTART;VALUE=DATE:20261016');
    expect(raw).toContain('DTEND;VALUE=DATE:20261018');
    expect(parseCalendarInvite(raw)).toMatchObject({
      all_day: true,
      starts_at: '2026-10-16T00:00:00.000Z',
      ends_at: '2026-10-18T00:00:00.000Z',
    });
  });
  it('rejeita conteúdo inválido, método desconhecido e destinatário inválido', () => {
    expect(parseCalendarInvite('not calendar')).toBeNull();
    expect(
      parseCalendarInvite(buildCalendarInvite(invite).replace('METHOD:REQUEST', 'METHOD:BOGUS')),
    ).toBeNull();
    expect(
      parseCalendarInvite(
        buildCalendarInvite(invite)
          .replace(/\r\n /g, '')
          .replace('mailto:guest@example.com', 'mailto:invalid'),
      ),
    ).toBeNull();
  });
});
describe('ocorrências de calendário', () => {
  const event = { ...invite, rrule: 'FREQ=DAILY;COUNT=4', exceptions: [] };
  it('expande recorrências com limite e intervalo exclusivo', () => {
    const list = calendarOccurrences(event, new Date('2026-10-16Z'), new Date('2026-10-20Z'));
    expect(list).toHaveLength(4);
    expect(list[3]?.start).toBe('2026-10-19T17:00:00.000Z');
  });
  it('preserva horário local na transição de horário de verão', () => {
    const list = calendarOccurrences(
      {
        ...event,
        starts_at: '2026-10-31T13:00:00.000Z',
        ends_at: '2026-10-31T14:00:00.000Z',
        timezone: 'America/New_York',
      },
      new Date('2026-10-31Z'),
      new Date('2026-11-04Z'),
    );
    expect(list.map((o) => o.start)).toEqual([
      '2026-10-31T13:00:00.000Z',
      '2026-11-01T14:00:00.000Z',
      '2026-11-02T14:00:00.000Z',
      '2026-11-03T14:00:00.000Z',
    ]);
  });
  it('aplica cancelamento e reagendamento sem duplicar ocorrência', () => {
    const list = calendarOccurrences(
      {
        ...event,
        exceptions: [
          { original: invite.starts_at, cancelled: true },
          {
            original: '2026-10-17T17:00:00.000Z',
            start: '2026-10-21T19:00:00.000Z',
            end: '2026-10-21T20:00:00.000Z',
            cancelled: false,
          },
        ],
      },
      new Date('2026-10-16Z'),
      new Date('2026-10-22Z'),
    );
    expect(list).toHaveLength(3);
    expect(list.filter((o) => o.original === '2026-10-17T17:00:00.000Z')).toHaveLength(1);
    expect(list.find((o) => o.original === '2026-10-17T17:00:00.000Z')?.start).toBe(
      '2026-10-21T19:00:00.000Z',
    );
  });
  it('limita resultados e valida duração', () => {
    expect(() =>
      calendarOccurrences(event, new Date('2026-10-16Z'), new Date('2026-10-22Z'), 1),
    ).toThrow();
    expect(
      calendarEventSchema.safeParse({
        ...invite,
        calendar_id: '123e4567-e89b-42d3-a456-426614174000',
        ends_at: invite.starts_at,
      }).success,
    ).toBe(false);
  });
});
