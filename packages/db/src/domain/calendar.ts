import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import {
  calendarEventSchema,
  calendarInviteSchema,
  attendeeSchema,
  calendarOccurrences,
  nextRecurrence,
  recurrenceSchema,
  resolveCalendarInviteTimezone,
  type CalendarInvite,
  type CalendarEventInput,
} from '@apmail/shared';
import type { Database } from './threads.js';
import type { CalendarEvents, Reminders } from '../types.js';
import { asJson } from './threads.js';
import { outboxJobId } from './outbox.js';
import { createNotification } from './notifications.js';
import { sanitizeEmailHtml } from '../sanitize.js';
import { calendarEmailHtml } from './calendar-email.js';
export type CalendarEventRow = Selectable<CalendarEvents>;
export async function dismissEventAlerts(
  db: Database,
  eventId: string,
  occurrence?: string | null,
) {
  const rows = await db
    .selectFrom('reminders')
    .select(['id', 'notification_id'])
    .where('event_id', '=', eventId)
    .where('status', '=', 'notified')
    .$if(!!occurrence, (q) => q.where('occurrence_at', '=', new Date(occurrence!)))
    .execute();
  if (!rows.length) return;
  await db
    .updateTable('reminders')
    .set({
      status: 'dismissed',
      alert_owner: null,
      alert_lease_until: null,
      updated_at: new Date(),
    })
    .where(
      'id',
      'in',
      rows.map((row) => row.id),
    )
    .execute();
  const notifications = rows.flatMap((row) => (row.notification_id ? [row.notification_id] : []));
  if (notifications.length)
    await db
      .updateTable('notifications')
      .set({ read_at: new Date() })
      .where('id', 'in', notifications)
      .where('read_at', 'is', null)
      .execute();
}
export async function continueReminder(db: Database, reminder: Selectable<Reminders>, after: Date) {
  if (!reminder.recurrence || reminder.event_id) return;
  const recurrence = recurrenceSchema.parse(reminder.recurrence),
    start = reminder.recurrence_start ?? reminder.due_at;
  const next = nextRecurrence(start, recurrence, after);
  if (
    next &&
    (!recurrence.max_occurrences || reminder.recurrence_index + 1 < recurrence.max_occurrences)
  )
    await db
      .insertInto('reminders')
      .values({
        tenant_id: reminder.tenant_id,
        user_id: reminder.user_id,
        title: reminder.title,
        notes: reminder.notes,
        due_at: next,
        recurrence: asJson(recurrence),
        recurrence_start: start,
        series_id: reminder.series_id,
        recurrence_index: reminder.recurrence_index + 1,
      })
      .onConflict((oc) => oc.columns(['series_id', 'recurrence_index']).doNothing())
      .execute();
}
export function eventInput(row: CalendarEventRow): CalendarEventInput {
  return calendarEventSchema.parse({
    ...row,
    starts_at: row.starts_at.toISOString(),
    ends_at: row.ends_at.toISOString(),
  });
}
export function eventInvite(
  row: CalendarEventRow,
  method: CalendarInvite['method'],
): CalendarInvite {
  return calendarInviteSchema.parse({
    ...eventInput(row),
    uid: row.uid,
    organizer: row.organizer ?? '',
    sequence: row.schedule_sequence,
    method,
  });
}
export async function ensureCalendar(db: Database, tenant: string, user: string) {
  await sql`select pg_advisory_xact_lock(hashtext(${tenant + user}))`.execute(db);
  return (
    (await db
      .selectFrom('calendars')
      .selectAll()
      .where('tenant_id', '=', tenant)
      .where('user_id', '=', user)
      .orderBy('created_at')
      .executeTakeFirst()) ??
    (await db
      .insertInto('calendars')
      .values({ tenant_id: tenant, user_id: user, name: 'Meu calendário' })
      .returningAll()
      .executeTakeFirstOrThrow())
  );
}
/** Persist the invitation and its outbox atomically. Existing outbox sweeper repairs queue loss. */
export async function calendarEmail(
  db: Database,
  row: CalendarEventRow,
  actor: string,
  invite: CalendarInvite,
  to: string[],
) {
  if (!row.mailbox_id || !to.length) return null;
  const outbox = await db
    .insertInto('outbox')
    .values({
      tenant_id: row.tenant_id,
      mailbox_id: row.mailbox_id,
      created_by: actor,
      subject: (
        (invite.method === 'CANCEL'
          ? 'Cancelado: '
          : invite.method === 'REPLY'
            ? 'Resposta: '
            : 'Convite: ') + invite.title
      ).replace(/[\r\n\0]/g, ' '),
      body_html: calendarEmailHtml(invite),
      to_addresses: asJson(
        [...new Set(to.map((v) => v.toLowerCase()))].map((address) => ({ address, name: '' })),
      ),
      calendar_payload: asJson({ ...invite, dtstamp: new Date().toISOString() }),
      status: 'queued',
      send_after: new Date(),
      submit_count: 1,
      message_id_header: `<${randomUUID()}@${invite.organizer.split('@')[1]}>`,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const job_id = outboxJobId(outbox.id, 1);
  await db.updateTable('outbox').set({ job_id }).where('id', '=', outbox.id).execute();
  return { ...outbox, job_id };
}
/** Validated organizer updates only affect events previously added by each user. */
export async function applyCalendarMessage(
  db: Database,
  invite: CalendarInvite,
  tenant: string,
  mailbox: string,
  sender: string,
) {
  const parsed = calendarInviteSchema.parse(invite);
  const v = parsed;
  if (!v.organizer) return;
  if (
    ['REQUEST', 'CANCEL'].includes(v.method) &&
    sender.toLowerCase() !== v.organizer.toLowerCase()
  )
    return;
  const rows = await db
    .selectFrom('calendar_events')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .where('mailbox_id', '=', mailbox)
    .where('uid', '=', v.uid)
    .forUpdate()
    .execute();
  for (const row of rows) {
    const v = resolveCalendarInviteTimezone(parsed, row.timezone);
    if (v.method === 'REPLY') {
      if (
        row.external ||
        row.organizer?.toLowerCase() !== v.organizer.toLowerCase() ||
        v.attendees.length !== 1 ||
        v.attendees[0]!.address.toLowerCase() !== sender.toLowerCase()
      )
        continue;
      const input = eventInput(row);
      const exception = v.recurrence_id
        ? input.exceptions.find((ex) => ex.original === v.recurrence_id)
        : undefined;
      if (v.sequence !== (exception?.sequence ?? row.schedule_sequence)) continue;
      if (
        v.recurrence_id &&
        (!row.rrule ||
          !calendarOccurrences(
            { ...input, exceptions: [] },
            new Date(v.recurrence_id),
            new Date(+new Date(v.recurrence_id) + 1000),
          ).some((o) => o.original === v.recurrence_id))
      )
        continue;
      const attendees = exception?.attendees ?? attendeeSchema.array().parse(row.attendees);
      if (!attendees.some((a) => a.address.toLowerCase() === sender.toLowerCase())) continue;
      const previous = attendees.find((a) => a.address.toLowerCase() === sender.toLowerCase());
      if (v.dtstamp && previous?.responded_at && v.dtstamp <= previous.responded_at) continue;
      const updated = attendees.map((a) =>
        a.address.toLowerCase() === sender.toLowerCase()
          ? {
              ...a,
              status: v.attendees[0]!.status,
              responded_at: v.dtstamp,
              response_sequence: v.sequence,
            }
          : a,
      );
      await db
        .updateTable('calendar_events')
        .set({
          ...(v.recurrence_id
            ? {
                exceptions: asJson([
                  ...input.exceptions.filter((ex) => ex.original !== v.recurrence_id),
                  {
                    ...exception,
                    original: v.recurrence_id,
                    cancelled: exception?.cancelled ?? false,
                    attendees: updated,
                  },
                ]),
              }
            : { attendees: asJson(updated) }),
          sequence: row.sequence + 1,
          updated_at: new Date(),
        })
        .where('id', '=', row.id)
        .execute();
      continue;
    }
    if (
      !row.external ||
      row.organizer?.toLowerCase() !== v.organizer.toLowerCase() ||
      v.sequence <=
        (v.recurrence_id
          ? (eventInput(row).exceptions.find((ex) => ex.original === v.recurrence_id)?.sequence ??
            row.schedule_sequence)
          : row.schedule_sequence)
    )
      continue;
    if (v.recurrence_id) {
      const input = eventInput(row),
        previous = input.exceptions.find((ex) => ex.original === v.recurrence_id);
      const oldAttendees = previous?.attendees ?? input.attendees;
      const exceptions = input.exceptions.filter((ex) => ex.original !== v.recurrence_id);
      exceptions.push({
        original: v.recurrence_id,
        start: v.starts_at,
        end: v.ends_at,
        title: v.title,
        cancelled:
          v.method === 'CANCEL' ||
          oldAttendees.some((a) => a.response_sequence !== undefined && a.status === 'DECLINED'),
        sequence: v.sequence,
        attendees: v.attendees.map((a) => ({
          ...a,
          ...oldAttendees.find((old) => old.address === a.address),
        })),
      });
      await db
        .updateTable('calendar_events')
        .set({
          exceptions: asJson(exceptions),
          sequence: row.sequence + 1,
          reminder_cursor: null,
          updated_at: new Date(),
        })
        .where('id', '=', row.id)
        .execute();
    } else {
      const attendees = attendeeSchema.array().parse(row.attendees);
      await db
        .updateTable('calendar_events')
        .set({
          title: v.title,
          description: v.description,
          description_html: v.description_html
            ? sanitizeEmailHtml(v.description_html, v.description)
            : '',
          meeting_url: v.meeting_url,
          availability: v.availability,
          category: v.category,
          is_private: v.is_private,
          location: v.location,
          starts_at: new Date(v.starts_at),
          ends_at: new Date(v.ends_at),
          timezone: v.timezone,
          timezone_definition: v.timezone_definition,
          all_day: v.all_day,
          rrule: v.rrule,
          exceptions: asJson(v.exceptions),
          sequence: row.sequence + 1,
          schedule_sequence: v.sequence,
          status:
            v.method === 'CANCEL' ||
            attendees.some((a) => a.response_sequence !== undefined && a.status === 'DECLINED')
              ? 'cancelled'
              : 'confirmed',
          attendees: asJson(
            v.attendees.map((a) => ({
              ...a,
              ...attendees.find((old) => old.address === a.address),
            })),
          ),
          reminder_cursor: null,
          updated_at: new Date(),
        })
        .where('id', '=', row.id)
        .execute();
    }
    if (v.method === 'CANCEL') await dismissEventAlerts(db, row.id, v.recurrence_id);
    await db
      .deleteFrom('reminders')
      .where('event_id', '=', row.id)
      .where('status', '=', 'pending')
      .execute();
  }
  // A calendar can contain a master plus independently revised exceptions.
  if (!v.recurrence_id && v.method !== 'REPLY')
    for (const exception of v.exceptions) {
      if (exception.sequence === undefined || !exception.start || !exception.end) continue;
      await applyCalendarMessage(
        db,
        {
          ...v,
          recurrence_id: exception.original,
          sequence: exception.sequence,
          starts_at: exception.start,
          ends_at: exception.end,
          title: exception.title ?? v.title,
          method: exception.cancelled ? 'CANCEL' : 'REQUEST',
          attendees: exception.attendees ?? v.attendees,
          exceptions: [],
          rrule: null,
        },
        tenant,
        mailbox,
        sender,
      );
    }
}
/** Called by the backend maintenance worker, independently of any browser session. */
export async function sweepCalendarReminders(db: Database, now = new Date()) {
  const notifications: Awaited<ReturnType<typeof createNotification>>[] = [];
  // Locking individual events/reminders makes parallel workers and retries safe.
  await db.transaction().execute(async (tx) => {
    const horizon = new Date(+now + 3600000);
    const events = await tx
      .selectFrom('calendar_events')
      .selectAll()
      .where('status', '=', 'confirmed')
      .where('reminder_minutes', 'is not', null)
      .where((eb) =>
        eb.or([eb('reminder_cursor', 'is', null), eb('reminder_cursor', '<', horizon)]),
      )
      .orderBy('reminder_cursor', 'asc')
      .limit(100)
      .forUpdate()
      .skipLocked()
      .execute();
    for (const row of events) {
      const offset = row.reminder_minutes! * 60000;
      const from =
        row.reminder_cursor ??
        new Date(Math.max(+row.created_at - offset, +row.starts_at - offset) - 1);
      const until = new Date(Math.min(+horizon, +from + 31 * 86400000));
      for (const occurrence of calendarOccurrences(
        eventInput(row),
        new Date(+from + offset),
        new Date(+until + offset),
      )) {
        const due = new Date(+new Date(occurrence.start) - offset);
        if (+due < +from || +new Date(occurrence.end) < +row.created_at) continue;
        await tx
          .insertInto('reminders')
          .values({
            tenant_id: row.tenant_id,
            user_id: row.user_id,
            event_id: row.id,
            occurrence_at: new Date(occurrence.original),
            event_start_at: new Date(occurrence.start),
            event_end_at: new Date(occurrence.end),
            title: occurrence.title ?? row.title,
            notes: row.location,
            due_at: due,
          })
          .onConflict((oc) => oc.columns(['event_id', 'occurrence_at']).doNothing())
          .execute();
      }
      await tx
        .updateTable('calendar_events')
        .set({ reminder_cursor: until })
        .where('id', '=', row.id)
        .execute();
    }
    const due = await tx
      .selectFrom('reminders')
      .selectAll()
      .where('status', '=', 'pending')
      .where('due_at', '<=', now)
      .orderBy('due_at')
      .limit(200)
      .forUpdate()
      .skipLocked()
      .execute();
    for (const reminder of due) {
      const notification = await createNotification(tx, {
        tenantId: reminder.tenant_id,
        userId: reminder.user_id,
        type: 'reminder',
        title: reminder.title,
        body: reminder.notes,
        link: '/reminders',
        payload: { reminder_id: reminder.id, event_id: reminder.event_id },
      });
      await tx
        .updateTable('reminders')
        .set({ status: 'notified', notification_id: notification.id, updated_at: now })
        .where('id', '=', reminder.id)
        .execute();
      notifications.push(notification);
      await continueReminder(tx, reminder, now);
    }
  });
  return notifications;
}
