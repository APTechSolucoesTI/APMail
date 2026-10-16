import { z } from 'zod';
import ICAL from 'ical.js';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { addressSchema } from './schemas/outbox.js';
import { recurrenceSchema } from './recurrence.js';

const timezoneSchema = recurrenceSchema.shape.timezone;
export const meetingUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .url()
  .refine((value) => {
    const authority = /^https:\/\/([^/?#\\\s]+)(?:[/?#]|$)/i.exec(value)?.[1];
    return !!authority && !authority.includes('@');
  }, 'Use um link de reunião HTTPS válido.');
export function googleMeetUrl(value: string): string | null {
  const match =
    /^https:\/\/meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})\/?(?:\?[^\s#]*)?(?:#[^\s]*)?$/.exec(
      value.trim(),
    );
  return match ? 'https://meet.google.com/' + match[1] : null;
}
const timezoneDefinitionSchema = z
  .string()
  .max(50000)
  .refine((value) => {
    try {
      return new ICAL.Component(ICAL.parse(value)).name === 'vtimezone';
    } catch {
      return false;
    }
  }, 'Definição de fuso inválida.')
  .nullable()
  .default(null);
export const attendeeSchema = addressSchema.extend({
  role: z.enum(['required', 'optional']).optional(),
  responded_at: z.iso.datetime().optional(),
  response_sequence: z.number().int().min(0).optional(),
  status: z.enum(['NEEDS-ACTION', 'ACCEPTED', 'DECLINED', 'TENTATIVE']).default('NEEDS-ACTION'),
});
export const exceptionSchema = z
  .object({
    original: z.iso.datetime(),
    start: z.iso.datetime().optional(),
    end: z.iso.datetime().optional(),
    title: z.string().trim().min(1).max(300).optional(),
    cancelled: z.boolean().default(false),
    attendees: z.array(attendeeSchema).max(100).optional(),
    sequence: z.number().int().min(0).optional(),
  })
  .refine((v) => !v.start || (!!v.end && new Date(v.end) > new Date(v.start)), 'Duração inválida.');
export const rruleSchema = z
  .string()
  .max(1000)
  .refine((value) => {
    try {
      if (!/^(FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY))(;[A-Z]+=[A-Z0-9,+-]+)*$/.test(value))
        return false;
      const rule = ICAL.Recur.fromString(value);
      const parts = new Map(value.split(';').map((part) => part.split('=') as [string, string]));
      if (parts.has('COUNT') && (!Number(parts.get('COUNT')) || Number(parts.get('COUNT')) < 1))
        return false;
      if (
        parts.has('INTERVAL') &&
        (!Number(parts.get('INTERVAL')) || Number(parts.get('INTERVAL')) < 1)
      )
        return false;
      const allowed = [
        'FREQ',
        'INTERVAL',
        'COUNT',
        'UNTIL',
        'BYDAY',
        'BYMONTHDAY',
        'BYMONTH',
        'BYSETPOS',
        'WKST',
      ];
      if (value.split(';').some((part) => !allowed.includes(part.split('=')[0]!))) return false;
      return (
        (!rule.interval || (rule.interval >= 1 && rule.interval <= 366)) &&
        (!rule.count || (rule.count >= 1 && rule.count <= 10000)) &&
        !(rule.count && rule.until)
      );
    } catch {
      return false;
    }
  }, 'Recorrência inválida. Use uma regra RRULE diária, semanal, mensal ou anual.');
export const calendarEventSchema = z
  .object({
    calendar_id: z.uuid(),
    mailbox_id: z.uuid().nullable().default(null),
    title: z.string().trim().min(1).max(300),
    description: z.string().max(20000).default(''),
    description_html: z.string().max(100000).default(''),
    meeting_url: meetingUrlSchema.nullable().default(null),
    availability: z.enum(['busy', 'free', 'tentative', 'out_of_office']).default('busy'),
    location: z.string().max(500).default(''),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    timezone: timezoneSchema.default('America/Sao_Paulo'),
    timezone_definition: timezoneDefinitionSchema,
    all_day: z.boolean().default(false),
    is_private: z.boolean().default(false),
    category: z.string().max(100).default(''),
    color: z
      .string()
      .regex(/^#[a-f\d]{6}$/i)
      .nullable()
      .default(null),
    attendees: z.array(attendeeSchema).max(100).default([]),
    rrule: rruleSchema.nullable().default(null),
    exceptions: z.array(exceptionSchema).max(1000).default([]),
    reminder_minutes: z.number().int().min(0).max(525600).nullable().default(15),
  })
  .refine(
    (v) => new Date(v.ends_at) > new Date(v.starts_at),
    'O término deve ser posterior ao início.',
  )
  .refine(
    (v) => new Date(v.ends_at).getTime() - new Date(v.starts_at).getTime() <= 366 * 86400000,
    'Duração máxima: um ano.',
  );
export type CalendarEventInput = z.infer<typeof calendarEventSchema>;
export type CalendarException = z.infer<typeof exceptionSchema>;
export type CalendarAttendee = z.infer<typeof attendeeSchema>;
export const reminderSchema = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(10000).default(''),
  due_at: z.iso.datetime(),
  recurrence: recurrenceSchema.nullable().default(null),
});
export const calendarInviteSchema = z
  .object({
    method: z.enum(['REQUEST', 'REPLY', 'CANCEL', 'PUBLISH']),
    uid: z
      .string()
      .min(1)
      .max(998)
      .refine((v) => !/[\r\n\0]/.test(v)),
    sequence: z.number().int().min(0).max(2147483647),
    dtstamp: z.iso.datetime().optional(),
    title: z.string().max(300),
    description: z.string().max(20000),
    description_html: z.string().max(100000).default(''),
    meeting_url: meetingUrlSchema.nullable().default(null),
    availability: z.enum(['busy', 'free', 'tentative', 'out_of_office']).default('busy'),
    location: z.string().max(500),
    category: z.string().max(100).default(''),
    is_private: z.boolean().default(false),
    organizer: z.union([z.email(), z.literal('')]),
    attendees: z.array(attendeeSchema).max(100),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    timezone: timezoneSchema,
    timezone_definition: timezoneDefinitionSchema,
    all_day: z.boolean(),
    floating: z.boolean().default(false),
    rrule: rruleSchema.nullable(),
    recurrence_id: z.iso.datetime().nullable().default(null),
    exceptions: z.array(exceptionSchema).max(1000).default([]),
  })
  .refine(
    (v) => v.method === 'PUBLISH' || !!v.organizer,
    'O organizador é obrigatório em convites e respostas.',
  );
export type CalendarInvite = z.infer<typeof calendarInviteSchema>;
export function resolveCalendarInviteTimezone(
  invite: CalendarInvite,
  timezone: string,
): CalendarInvite {
  if (!invite.floating) return invite;
  const convert = (value: string) => calendarInstant(value.slice(0, 19), timezone);
  return {
    ...invite,
    floating: false,
    timezone,
    starts_at: convert(invite.starts_at),
    ends_at: convert(invite.ends_at),
    recurrence_id: invite.recurrence_id ? convert(invite.recurrence_id) : null,
    exceptions: invite.exceptions.map((ex) => ({
      ...ex,
      original: convert(ex.original),
      ...(ex.start ? { start: convert(ex.start), end: convert(ex.end!) } : {}),
    })),
  };
}
export type CalendarOccurrence = { original: string; start: string; end: string; title?: string };
export const calendarLocalInput = (instant: string, timezone: string) =>
  formatInTimeZone(new Date(instant), timezone, "yyyy-MM-dd'T'HH:mm");
export const calendarInstant = (local: string, timezone: string) =>
  fromZonedTime(local, timezone).toISOString();

/** Expand in the event's wall-clock timezone, then apply occurrence exceptions. */
export function calendarOccurrences(
  event: Pick<CalendarEventInput, 'starts_at' | 'ends_at' | 'timezone' | 'rrule' | 'exceptions'> & {
    timezone_definition?: string | null;
    all_day?: boolean;
  },
  from: Date,
  to: Date,
  limit = 2000,
): CalendarOccurrence[] {
  const duration = +new Date(event.ends_at) - +new Date(event.starts_at);
  const result: CalendarOccurrence[] = [];
  const add = (date: Date) => {
    const original = date.toISOString();
    const exception = event.exceptions.find((e) => e.original === original);
    if (exception?.cancelled) return;
    let defaultEnd = new Date(+date + duration).toISOString();
    if (event.all_day) {
      const days =
        (+new Date(calendarLocalInput(event.ends_at, event.timezone).slice(0, 10) + 'T00:00:00Z') -
          +new Date(
            calendarLocalInput(event.starts_at, event.timezone).slice(0, 10) + 'T00:00:00Z',
          )) /
        86400000;
      const dateOnly = calendarLocalInput(original, event.timezone).slice(0, 10);
      defaultEnd = calendarInstant(
        new Date(+new Date(dateOnly + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10) +
          'T00:00',
        event.timezone,
      );
    }
    const start = exception?.start ?? original,
      end = exception?.end ?? defaultEnd;
    if (+new Date(start) < +to && +new Date(end) > +from)
      result.push({ original, start, end, title: exception?.title });
    if (result.length > limit) throw new Error('Muitas ocorrências. Reduza o período.');
  };
  if (!event.rrule) add(new Date(event.starts_at));
  else {
    const rule = ICAL.Recur.fromString(rruleSchema.parse(event.rrule));
    const zone = event.timezone_definition
      ? new ICAL.Timezone({ component: new ICAL.Component(ICAL.parse(event.timezone_definition)) })
      : null;
    const start = zone
      ? ICAL.Time.fromJSDate(new Date(event.starts_at), true).convertToZone(zone)
      : ICAL.Time.fromString(
          formatInTimeZone(new Date(event.starts_at), event.timezone, "yyyy-MM-dd'T'HH:mm:ss"),
          undefined,
        );
    const iterator = rule.iterator(start);
    let iterations = 0;
    while (true) {
      const next = iterator.next();
      if (!next) break;
      if (++iterations > 100000) throw new Error('Recorrência excede o limite de processamento.');
      const date = zone
        ? next.toJSDate()
        : fromZonedTime(next.toString().slice(0, 19), event.timezone);
      if (+date >= +to) break;
      add(date);
    }
    // A moved exception can enter this range even if its original date is outside it.
    for (const ex of event.exceptions) {
      if (
        ex.start &&
        !ex.cancelled &&
        !result.some((r) => r.original === ex.original) &&
        +new Date(ex.start) < +to &&
        +new Date(ex.end!) > +from
      )
        result.push({ original: ex.original, start: ex.start, end: ex.end!, title: ex.title });
    }
  }
  return result;
}

const text = (component: InstanceType<typeof ICAL.Component>, name: string) =>
  String(component.getFirstPropertyValue(name) ?? '');
// Generate VTIMEZONE from the runtime's current IANA database. No remote TZURL fetch.
const zoneCache = new Map<string, string>();
function timezoneComponent(timezone: string, year: number) {
  const key = timezone + year,
    cached = zoneCache.get(key);
  if (cached) return new ICAL.Component(ICAL.parse(cached));
  const zone = new ICAL.Component('vtimezone');
  zone.updatePropertyWithValue('tzid', timezone);
  const offset = (instant: number) => {
    const value = formatInTimeZone(new Date(instant), timezone, 'xxx');
    const [h, m] = value.slice(1).split(':').map(Number);
    return (value[0] === '-' ? -1 : 1) * (h! * 3600 + m! * 60);
  };
  const first = Date.UTC(year - 1, 0, 1),
    last = Date.UTC(year + 31, 0, 1);
  let previous = offset(first);
  const add = (instant: number, from: number, to: number) => {
    const part = new ICAL.Component(to > from ? 'daylight' : 'standard');
    part.updatePropertyWithValue(
      'dtstart',
      ICAL.Time.fromString(new Date(instant + from * 1000).toISOString().slice(0, 19), undefined),
    );
    part.updatePropertyWithValue('tzoffsetfrom', ICAL.UtcOffset.fromSeconds(from));
    part.updatePropertyWithValue('tzoffsetto', ICAL.UtcOffset.fromSeconds(to));
    zone.addSubcomponent(part);
  };
  add(first, previous, previous);
  for (let day = first + 86400000; day <= last; day += 86400000) {
    const next = offset(day);
    if (next === previous) continue;
    let lo = day - 86400000,
      hi = day;
    while (hi - lo > 1000) {
      const mid = Math.floor((lo + hi) / 2000) * 1000;
      if (offset(mid) === previous) lo = mid;
      else hi = mid;
    }
    add(hi, previous, next);
    previous = next;
  }
  if (zoneCache.size >= 40) zoneCache.clear();
  zoneCache.set(key, zone.toString());
  return zone;
}
/** Parse untrusted MIME calendar parts without fetching URLs or executing alarms. */
export function parseCalendarInvite(
  source: string,
  fallbackTimezone = 'UTC',
): CalendarInvite | null {
  if (source.length > 2000000) return null;
  try {
    const root = new ICAL.Component(ICAL.parse(source));
    if (root.name !== 'vcalendar') return null;
    const components = root.getAllSubcomponents('vevent');
    const component = components.find((c) => !c.hasProperty('recurrence-id')) ?? components[0];
    if (!component || components.length > 1001) return null;
    const event = new ICAL.Event(component);
    const timezoneValue = component.getFirstProperty('dtstart')?.getParameter('tzid');
    const timezone = timezoneSchema.safeParse(timezoneValue).success
      ? String(timezoneValue)
      : fallbackTimezone;
    const date = (time: InstanceType<typeof ICAL.Time>): string => {
      if (time.zone.tzid === 'UTC') return time.toJSDate().toISOString();
      // Embedded VTIMEZONE definitions take precedence over IANA fallback.
      const zone = root
        .getAllSubcomponents('vtimezone')
        .find((c) => text(c, 'tzid') === timezoneValue);
      if (zone) {
        time.zone = new ICAL.Timezone({ component: zone });
        return time.toJSDate().toISOString();
      }
      return fromZonedTime(time.toString().slice(0, 19), timezone).toISOString();
    };
    const email = (value: unknown) =>
      String(value ?? '')
        .replace(/^mailto:/i, '')
        .trim()
        .toLowerCase();
    const start = date(event.startDate),
      end = event.endDate
        ? date(event.endDate)
        : new Date(+new Date(start) + 3600000).toISOString();
    const exceptions: CalendarException[] = component
      .getAllProperties('exdate')
      .flatMap((p) =>
        p
          .getValues()
          .map((v) => ({ original: date(v as InstanceType<typeof ICAL.Time>), cancelled: true })),
      );
    for (const c of components.filter((c) => c !== component && c.hasProperty('recurrence-id'))) {
      if (text(c, 'uid') !== event.uid) return null;
      const ex = new ICAL.Event(c);
      exceptions.push({
        original: date(ex.recurrenceId),
        start: date(ex.startDate),
        end: date(ex.endDate),
        cancelled: text(c, 'status') === 'CANCELLED',
        title: ex.summary,
        sequence: Number(text(c, 'sequence') || text(component, 'sequence') || 0),
        ...(c.hasProperty('attendee')
          ? {
              attendees: attendeeSchema.array().parse(
                c.getAllProperties('attendee').map((p) => ({
                  address: email(p.getFirstValue()),
                  name: String(p.getParameter('cn') ?? ''),
                  status: p.getParameter('partstat') || 'NEEDS-ACTION',
                  role: p.getParameter('role') === 'OPT-PARTICIPANT' ? 'optional' : 'required',
                })),
              ),
            }
          : {}),
      });
    }
    const parsed = calendarInviteSchema.safeParse({
      method: text(root, 'method').toUpperCase() || 'PUBLISH',
      uid: event.uid,
      sequence: Number(text(component, 'sequence') || 0),
      dtstamp: component.hasProperty('dtstamp')
        ? date(component.getFirstPropertyValue('dtstamp') as InstanceType<typeof ICAL.Time>)
        : undefined,
      title: event.summary || 'Compromisso',
      description: (event.description || '').slice(0, 20000),
      description_html: text(component, 'x-alt-desc').slice(0, 100000),
      meeting_url: (() => {
        const candidate =
          text(component, 'conference') ||
          text(component, 'x-google-conference') ||
          googleMeetUrl(text(component, 'url'));
        return meetingUrlSchema.safeParse(candidate).success ? candidate : null;
      })(),
      availability:
        text(component, 'transp').toUpperCase() === 'TRANSPARENT'
          ? 'free'
          : text(component, 'x-apmail-availability') || 'busy',
      location: (event.location || '').slice(0, 500),
      category: text(component, 'categories').slice(0, 100),
      is_private: text(component, 'class').toUpperCase() === 'PRIVATE',
      organizer: email(event.organizer),
      attendees: component.getAllProperties('attendee').map((p) => ({
        address: email(p.getFirstValue()),
        name: String(p.getParameter('cn') ?? ''),
        status: p.getParameter('partstat') || 'NEEDS-ACTION',
        role: p.getParameter('role') === 'OPT-PARTICIPANT' ? 'optional' : 'required',
      })),
      starts_at: start,
      ends_at: end,
      timezone,
      all_day: event.startDate.isDate,
      floating: !event.startDate.isDate && !timezoneValue && event.startDate.zone.tzid !== 'UTC',
      timezone_definition:
        root
          .getAllSubcomponents('vtimezone')
          .find((c) => text(c, 'tzid') === timezoneValue)
          ?.toString() ?? null,
      rrule: component.hasProperty('rrule')
        ? String(component.getFirstPropertyValue('rrule'))
        : null,
      recurrence_id: component.hasProperty('recurrence-id') ? date(event.recurrenceId) : null,
      exceptions,
    });
    return parsed.success && +new Date(end) > +new Date(start) ? parsed.data : null;
  } catch {
    return null;
  }
}

/** RFC 5545 serializer handles UTF-8 folding, escaping and typed DATE values. */
export function buildCalendarInvite(value: CalendarInvite): string {
  const v = calendarInviteSchema.parse(value),
    root = new ICAL.Component('vcalendar');
  root.updatePropertyWithValue('version', '2.0');
  root.updatePropertyWithValue('prodid', '-//APMail//Calendário//PT-BR');
  root.updatePropertyWithValue('method', v.method);
  const component = new ICAL.Component('vevent'),
    event = new ICAL.Event(component);
  event.uid = v.uid;
  event.summary = v.title;
  event.description =
    v.description +
    (v.meeting_url && !v.description.includes(v.meeting_url)
      ? '\n\nEntrar na reunião: ' + v.meeting_url
      : '');
  if (v.description_html) {
    const p = new ICAL.Property('x-alt-desc');
    p.setParameter('fmttype', 'text/html');
    p.setValue(v.description_html);
    component.addProperty(p);
  }
  if (v.meeting_url) {
    component.updatePropertyWithValue('url', v.meeting_url);
    const p = new ICAL.Property('conference');
    p.setParameter('value', 'URI');
    p.setValue(v.meeting_url);
    component.addProperty(p);
    if (googleMeetUrl(v.meeting_url))
      component.updatePropertyWithValue('x-google-conference', v.meeting_url);
  }
  component.updatePropertyWithValue('transp', v.availability === 'free' ? 'TRANSPARENT' : 'OPAQUE');
  component.updatePropertyWithValue(
    'x-microsoft-cdo-busystatus',
    { free: 'FREE', busy: 'BUSY', tentative: 'TENTATIVE', out_of_office: 'OOF' }[v.availability],
  );
  if (v.availability === 'tentative' && v.method !== 'CANCEL')
    component.updatePropertyWithValue('status', 'TENTATIVE');
  component.updatePropertyWithValue('x-apmail-availability', v.availability);
  event.location = v.location;
  event.startDate = v.all_day
    ? ICAL.Time.fromDateString(formatInTimeZone(new Date(v.starts_at), v.timezone, 'yyyy-MM-dd'))
    : ICAL.Time.fromJSDate(new Date(v.starts_at), true);
  event.endDate = v.all_day
    ? ICAL.Time.fromDateString(formatInTimeZone(new Date(v.ends_at), v.timezone, 'yyyy-MM-dd'))
    : ICAL.Time.fromJSDate(new Date(v.ends_at), true);
  component.updatePropertyWithValue(
    'dtstamp',
    ICAL.Time.fromJSDate(new Date(v.dtstamp ?? Date.now()), true),
  );
  component.updatePropertyWithValue('sequence', v.sequence);
  component.updatePropertyWithValue('class', v.is_private ? 'PRIVATE' : 'PUBLIC');
  if (v.category) component.updatePropertyWithValue('categories', v.category);
  if (v.organizer) component.updatePropertyWithValue('organizer', 'mailto:' + v.organizer);
  if (v.method === 'CANCEL') component.updatePropertyWithValue('status', 'CANCELLED');
  for (const a of v.attendees) {
    const property = new ICAL.Property('attendee');
    property.setValue('mailto:' + a.address);
    property.setParameter('cn', a.name);
    property.setParameter('partstat', a.status);
    property.setParameter('role', a.role === 'optional' ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT');
    if (v.method === 'REQUEST') property.setParameter('rsvp', 'TRUE');
    component.addProperty(property);
  }
  if (v.rrule) component.updatePropertyWithValue('rrule', ICAL.Recur.fromString(v.rrule));
  if (!v.all_day && (v.rrule || v.timezone_definition)) {
    const zone = v.timezone_definition
      ? new ICAL.Component(ICAL.parse(v.timezone_definition))
      : timezoneComponent(v.timezone, new Date(v.starts_at).getUTCFullYear());
    const tz = new ICAL.Timezone({ component: zone });
    root.addSubcomponent(zone);
    event.startDate = ICAL.Time.fromJSDate(new Date(v.starts_at), true).convertToZone(tz);
    event.endDate = ICAL.Time.fromJSDate(new Date(v.ends_at), true).convertToZone(tz);
  }
  // Recurrence identifiers and exclusions must have the same value type and zone as DTSTART.
  const setOccurrenceDate = (
    target: ICAL.Component,
    name: string,
    instant: string,
    replace = true,
  ) => {
    const value = v.all_day
      ? ICAL.Time.fromDateString(formatInTimeZone(new Date(instant), v.timezone, 'yyyy-MM-dd'))
      : ICAL.Time.fromJSDate(new Date(instant), true).convertToZone(event.startDate.zone);
    if (replace) target.removeAllProperties(name);
    const property = new ICAL.Property(name);
    property.setValue(value);
    if (!value.isDate && value.zone.tzid !== 'UTC' && value.zone.tzid !== 'floating')
      property.setParameter('tzid', value.zone.tzid);
    target.addProperty(property);
  };
  if (v.recurrence_id) setOccurrenceDate(component, 'recurrence-id', v.recurrence_id);
  for (const ex of v.exceptions) {
    if (ex.cancelled) {
      setOccurrenceDate(component, 'exdate', ex.original, false);
    } else if (ex.start && ex.end) {
      const override = new ICAL.Component(ICAL.parse(component.toString()));
      override.removeAllProperties('rrule');
      override.removeAllProperties('description');
      if (ex.attendees) {
        override.removeAllProperties('attendee');
        for (const attendee of ex.attendees) {
          const property = new ICAL.Property('attendee');
          property.setValue('mailto:' + attendee.address);
          property.setParameter('cn', attendee.name);
          property.setParameter('partstat', attendee.status);
          property.setParameter(
            'role',
            attendee.role === 'optional' ? 'OPT-PARTICIPANT' : 'REQ-PARTICIPANT',
          );
          if (v.method === 'REQUEST') property.setParameter('rsvp', 'TRUE');
          override.addProperty(property);
        }
      }
      override.updatePropertyWithValue('sequence', ex.sequence ?? v.sequence);
      override.removeAllProperties('exdate');
      setOccurrenceDate(override, 'recurrence-id', ex.original);
      setOccurrenceDate(override, 'dtstart', ex.start);
      setOccurrenceDate(override, 'dtend', ex.end);
      if (ex.title) override.updatePropertyWithValue('summary', ex.title);
      root.addSubcomponent(override);
    }
  }
  root.addSubcomponent(component);
  return root.toString() + '\r\n';
}
