import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { sql } from 'kysely';
import {
  asJson,
  calendarEmail,
  ensureCalendar,
  eventInput,
  eventInvite,
  sendJobOptions,
  continueReminder,
  sanitizeEmailHtml,
  htmlToText,
  dismissEventAlerts,
} from '@apmail/db';
import {
  calendarEventSchema,
  calendarOccurrences,
  calendarInviteSchema,
  exceptionSchema,
  reminderSchema,
  buildCalendarInvite,
  calendarLocalInput,
  resolveCalendarInviteTimezone,
} from '@apmail/shared';
import {
  requireTenant,
  notFound,
  conflict,
  ApiError,
  type RequestContext,
} from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import { requireFolder } from '../authz/folders.js';
import type { Resources } from './resources.js';
const idOf = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
export async function registerCalendar(app: FastifyInstance, r: Resources) {
  const changed = (user: string) => r.io.to('user:' + user).emit('calendar:changed', {});
  const owned = async (ctx: RequestContext | null, id: string) => {
    const c = requireTenant(ctx);
    const row = await r.db
      .selectFrom('calendar_events')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    if (!row) throw notFound();
    return { c, row };
  };
  const dispatch = async (row: Awaited<ReturnType<typeof calendarEmail>>) => {
    if (row)
      await r.queues['outbox-send']
        .add('send', { outbox_id: row.id }, sendJobOptions(row))
        .catch(() => app.log.warn('Convite persistido; recuperação da fila pendente.'));
  };
  const connected = async (c: ReturnType<typeof requireTenant>, mailbox: string) => {
    await requireMailboxPerm(c, r.db, mailbox, 'send');
    const box = await r.db
      .selectFrom('mailboxes')
      .selectAll()
      .where('id', '=', mailbox)
      .where('tenant_id', '=', c.tenantId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!box || box.status !== 'active' || box.receiving_protocol === 'local')
      throw conflict('Selecione uma conta conectada para enviar convites.');
    return box;
  };
  app.get('/api/calendars', async (req) => {
    const c = requireTenant(req.ctx);
    await r.db.transaction().execute((tx) => ensureCalendar(tx, c.tenantId, c.userId));
    return r.db
      .selectFrom('calendars')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .orderBy('created_at')
      .execute();
  });
  app.post('/api/calendars', async (req) => {
    const c = requireTenant(req.ctx),
      body = z
        .object({
          name: z.string().trim().min(1).max(100),
          color: z.string().regex(/^#[a-f\d]{6}$/i),
          timezone: calendarEventSchema.shape.timezone,
        })
        .parse(req.body);
    const row = await r.db
      .insertInto('calendars')
      .values({ ...body, tenant_id: c.tenantId, user_id: c.userId })
      .returningAll()
      .executeTakeFirstOrThrow();
    changed(c.userId);
    return row;
  });
  app.get('/api/calendar/events', async (req) => {
    const c = requireTenant(req.ctx),
      q = z
        .object({
          from: z.iso.datetime(),
          to: z.iso.datetime(),
          search: z.string().max(200).default(''),
          calendar_id: z.uuid().optional(),
          type: z.enum(['all', 'meeting', 'appointment']).default('all'),
        })
        .parse(req.query);
    if (
      +new Date(q.to) <= +new Date(q.from) ||
      +new Date(q.to) - +new Date(q.from) > 370 * 86400000
    )
      throw new ApiError(400, 'invalid_range', 'Selecione um período de até um ano.');
    let query = r.db
      .selectFrom('calendar_events as e')
      .innerJoin('calendars as c', 'c.id', 'e.calendar_id')
      .selectAll('e')
      .select(['c.name as calendar_name', 'c.color as calendar_color'])
      .where('e.tenant_id', '=', c.tenantId)
      .where('e.user_id', '=', c.userId)
      .where('e.status', '=', 'confirmed')
      .where((eb) =>
        eb.or([
          eb('e.rrule', 'is not', null),
          eb.and([eb('e.starts_at', '<', new Date(q.to)), eb('e.ends_at', '>', new Date(q.from))]),
        ]),
      );
    if (q.search)
      query = query.where((eb) =>
        eb.or([
          eb('e.title', 'ilike', '%' + q.search + '%'),
          eb('e.description', 'ilike', '%' + q.search + '%'),
          eb('e.location', 'ilike', '%' + q.search + '%'),
        ]),
      );
    if (q.calendar_id) query = query.where('e.calendar_id', '=', q.calendar_id);
    if (q.type === 'meeting') query = query.where(sql<boolean>`jsonb_array_length(e.attendees)>0`);
    if (q.type === 'appointment')
      query = query.where(sql<boolean>`jsonb_array_length(e.attendees)=0`);
    const rows = await query.limit(2001).execute();
    if (rows.length > 2000) throw conflict('Muitos eventos. Filtre por calendário ou pesquisa.');
    return rows.flatMap((row) =>
      calendarOccurrences(eventInput(row), new Date(q.from), new Date(q.to)).map((occurrence) => ({
        id: row.id + '~' + occurrence.original,
        event_id: row.id,
        original: occurrence.original,
        title: occurrence.title ?? row.title,
        start: row.all_day
          ? calendarLocalInput(occurrence.start, row.timezone).slice(0, 10)
          : occurrence.start,
        end: row.all_day
          ? calendarLocalInput(occurrence.end, row.timezone).slice(0, 10)
          : occurrence.end,
        allDay: row.all_day,
        color: row.color ?? row.calendar_color,
        calendar_name: row.calendar_name,
        editable: !row.external,
        recurring: !!row.rrule,
        location: row.location,
      })),
    );
  });
  app.get('/api/calendar/events/:id', async (req) => (await owned(req.ctx, idOf(req.params))).row);
  app.patch('/api/calendar/events/:id/preferences', async (req) => {
    const { c, row } = await owned(req.ctx, idOf(req.params));
    const body = z
      .object({
        calendar_id: calendarEventSchema.shape.calendar_id,
        reminder_minutes: calendarEventSchema.shape.reminder_minutes,
        is_private: calendarEventSchema.shape.is_private,
        color: calendarEventSchema.shape.color,
        category: calendarEventSchema.shape.category,
        version: z.number().int(),
      })
      .parse(req.body);
    const calendar = await r.db
      .selectFrom('calendars')
      .select('id')
      .where('id', '=', body.calendar_id)
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    if (!calendar) throw notFound();
    const updated = await r.db.transaction().execute(async (tx) => {
      const { version, ...values } = body;
      const updated = await tx
        .updateTable('calendar_events')
        .set({
          ...values,
          sequence: row.sequence + 1,
          updated_at: new Date(),
          reminder_cursor: null,
        })
        .where('id', '=', row.id)
        .where('sequence', '=', version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw conflict('O evento foi atualizado. Abra novamente.');
      await tx
        .deleteFrom('reminders')
        .where('event_id', '=', row.id)
        .where('status', '=', 'pending')
        .execute();
      return updated;
    });
    changed(c.userId);
    return updated;
  });
  app.get('/api/calendar/events/:id/ics', async (req, reply) => {
    const { row } = await owned(req.ctx, idOf(req.params));
    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="evento.ics"')
      .send(
        buildCalendarInvite({
          ...eventInvite(row, 'PUBLISH'),
        }),
      );
  });
  const saveEvent = async (req: import('fastify').FastifyRequest, id?: string) => {
    const c = requireTenant(req.ctx),
      body = calendarEventSchema.parse(req.body);
    body.description_html = body.description_html
      ? sanitizeEmailHtml(body.description_html, body.description)
      : '';
    if (body.description_html) body.description = htmlToText(body.description_html).slice(0, 20000);
    const control = z
      .object({ version: z.number().int().optional(), send_invitations: z.boolean().default(true) })
      .parse(req.body);
    const old = id ? (await owned(req.ctx, id)).row : null;
    if (old?.external)
      throw conflict('Este evento é gerenciado pelo organizador. Responda pelo convite recebido.');
    if (old && control.version !== old.sequence)
      throw conflict('O evento foi atualizado. Abra novamente antes de salvar.');
    const calendar = await r.db
      .selectFrom('calendars')
      .select('id')
      .where('id', '=', body.calendar_id)
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .executeTakeFirst();
    if (!calendar) throw notFound();
    const box = body.mailbox_id ? await connected(c, body.mailbox_id) : null;
    if (body.attendees.length && !box) throw conflict('Selecione a conta que enviará os convites.');
    if (old?.organizer && old.mailbox_id !== body.mailbox_id)
      throw conflict('Mantenha a conta organizadora desta reunião.');
    const rescheduled =
      old &&
      (old.starts_at.toISOString() !== body.starts_at ||
        old.ends_at.toISOString() !== body.ends_at ||
        old.rrule !== body.rrule);
    const knownAttendees = old ? eventInput(old).attendees : [];
    body.attendees = body.attendees.map((a) => ({
      ...(!rescheduled
        ? knownAttendees.find((old) => old.address === a.address.toLowerCase())
        : {}),
      address: a.address,
      name: a.name,
      role: a.role ?? 'required',
      ...(!rescheduled &&
      knownAttendees.find((old) => old.address === a.address.toLowerCase())?.responded_at
        ? {
            responded_at: knownAttendees.find((old) => old.address === a.address.toLowerCase())!
              .responded_at,
          }
        : {}),
      status: rescheduled
        ? 'NEEDS-ACTION'
        : (knownAttendees.find((old) => old.address === a.address.toLowerCase())?.status ??
          'NEEDS-ACTION'),
    }));
    const seen = new Set<string>();
    body.attendees = body.attendees.filter((a) => {
      a.address = a.address.toLowerCase();
      if (seen.has(a.address) || a.address === box?.email_address.toLowerCase()) return false;
      seen.add(a.address);
      return true;
    });
    if (old) {
      const previous = eventInput(old);
      previous.attendees = previous.attendees.map((a) => ({ ...a, role: a.role ?? 'required' }));
      if (isDeepStrictEqual(previous, body)) {
        if (control.send_invitations && old.organizer && body.attendees.length) {
          const mail = await r.db.transaction().execute(async (tx) => {
            const current = await tx
              .selectFrom('calendar_events')
              .selectAll()
              .where('id', '=', old.id)
              .forUpdate()
              .executeTakeFirstOrThrow();
            if (current.sequence !== control.version)
              throw conflict('O evento foi atualizado. Abra novamente.');
            const exists = await tx
              .selectFrom('outbox')
              .select('id')
              .where('tenant_id', '=', c.tenantId)
              .where('mailbox_id', '=', current.mailbox_id!)
              .where(sql<string>`calendar_payload->>'uid'`, '=', current.uid)
              .where(sql<string>`calendar_payload->>'method'`, '=', 'REQUEST')
              .where(
                sql<string>`calendar_payload->>'sequence'`,
                '=',
                String(current.schedule_sequence),
              )
              .where(sql<string>`calendar_payload->>'recurrence_id'`, 'is', null)
              .executeTakeFirst();
            return exists
              ? null
              : calendarEmail(
                  tx,
                  current,
                  c.userId,
                  eventInvite(current, 'REQUEST'),
                  body.attendees.map((a) => a.address),
                );
          });
          await dispatch(mail);
          if (mail) changed(c.userId);
        }
        return old;
      }
    }
    const result = await r.db.transaction().execute(async (tx) => {
      if (old) {
        const latest = await tx
          .selectFrom('calendar_events')
          .select('sequence')
          .where('id', '=', old.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        if (latest.sequence !== control.version)
          throw conflict('O evento foi atualizado. Abra novamente.');
      }
      const values = {
        ...body,
        starts_at: new Date(body.starts_at),
        ends_at: new Date(body.ends_at),
        attendees: asJson(body.attendees),
        exceptions: asJson(body.exceptions),
        organizer: box?.email_address ?? null,
        sequence: (old?.sequence ?? -1) + 1,
        schedule_sequence: (old?.schedule_sequence ?? -1) + 1,
        reminder_cursor: null,
        updated_at: new Date(),
      };
      const row = old
        ? await tx
            .updateTable('calendar_events')
            .set(values)
            .where('id', '=', old.id)
            .returningAll()
            .executeTakeFirstOrThrow()
        : await tx
            .insertInto('calendar_events')
            .values({
              ...values,
              tenant_id: c.tenantId,
              user_id: c.userId,
              uid: randomUUID() + '@apmail.local',
            })
            .returningAll()
            .executeTakeFirstOrThrow();
      if (old)
        await tx
          .deleteFrom('reminders')
          .where('event_id', '=', row.id)
          .where('status', '=', 'pending')
          .execute();
      const mails = [];
      if (control.send_invitations && row.organizer) {
        mails.push(
          await calendarEmail(
            tx,
            row,
            c.userId,
            eventInvite(row, 'REQUEST'),
            body.attendees.map((a) => a.address),
          ),
        );
        const removed = old ? eventInput(old).attendees.filter((a) => !seen.has(a.address)) : [];
        if (removed.length)
          mails.push(
            await calendarEmail(
              tx,
              row,
              c.userId,
              { ...eventInvite(row, 'CANCEL'), attendees: removed },
              removed.map((a) => a.address),
            ),
          );
      }
      return { row, mails };
    });
    for (const mail of result.mails) await dispatch(mail);
    changed(c.userId);
    return result.row;
  };
  app.post('/api/calendar/events', (req) => saveEvent(req));
  app.patch('/api/calendar/events/:id', (req) => saveEvent(req, idOf(req.params)));
  app.post('/api/calendar/events/:id/occurrence', async (req) => {
    const { c, row } = await owned(req.ctx, idOf(req.params));
    if (row.external || !row.rrule) throw conflict('Esta ocorrência não pode ser alterada.');
    if (row.mailbox_id) await connected(c, row.mailbox_id);
    const body = exceptionSchema.parse(req.body),
      version = z.object({ version: z.number().int() }).parse(req.body).version;
    const input = eventInput(row);
    if (
      !calendarOccurrences(
        { ...input, exceptions: [] },
        new Date(body.original),
        new Date(+new Date(body.original) + 1000),
      ).some((o) => o.original === body.original)
    )
      throw conflict('Ocorrência inválida.');
    const previous = input.exceptions.find((ex) => ex.original === body.original);
    const exception = {
      ...body,
      sequence: (previous?.sequence ?? row.schedule_sequence) + 1,
      attendees: input.attendees.map((a) => ({
        address: a.address,
        name: a.name,
        status: 'NEEDS-ACTION' as const,
      })),
    };
    const exceptions = [
      ...input.exceptions.filter((ex) => ex.original !== body.original),
      exception,
    ];
    const result = await r.db.transaction().execute(async (tx) => {
      const updated = await tx
        .updateTable('calendar_events')
        .set({
          exceptions: asJson(exceptions),
          sequence: row.sequence + 1,
          updated_at: new Date(),
          reminder_cursor: null,
        })
        .where('id', '=', row.id)
        .where('sequence', '=', version)
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw conflict('O evento foi atualizado. Abra novamente.');
      if (body.cancelled) await dismissEventAlerts(tx, row.id, body.original);
      await tx
        .deleteFrom('reminders')
        .where('event_id', '=', row.id)
        .where('status', '=', 'pending')
        .execute();
      const invite = updated.organizer
        ? {
            ...eventInvite(updated, body.cancelled ? 'CANCEL' : 'REQUEST'),
            recurrence_id: body.original,
            sequence: exception.sequence,
            attendees: exception.attendees,
            starts_at: body.start ?? body.original,
            ends_at:
              body.end ??
              new Date(+new Date(body.original) + (+row.ends_at - +row.starts_at)).toISOString(),
            title: body.title ?? row.title,
            rrule: null,
            exceptions: [],
          }
        : null;
      return {
        row: updated,
        mail: invite
          ? await calendarEmail(
              tx,
              updated,
              c.userId,
              invite,
              input.attendees.map((a) => a.address),
            )
          : null,
      };
    });
    await dispatch(result.mail);
    changed(c.userId);
    return result.row;
  });
  app.delete('/api/calendar/events/:id', async (req) => {
    const { c, row } = await owned(req.ctx, idOf(req.params));
    if (row.mailbox_id && !row.external) await connected(c, row.mailbox_id);
    const version = z.object({ version: z.number().int() }).parse(req.body).version;
    const mail = await r.db.transaction().execute(async (tx) => {
      const updated = await tx
        .updateTable('calendar_events')
        .set({
          status: 'cancelled',
          sequence: row.sequence + 1,
          schedule_sequence: row.schedule_sequence + 1,
          updated_at: new Date(),
        })
        .where('id', '=', row.id)
        .where('sequence', '=', version)
        .where('status', '=', 'confirmed')
        .returningAll()
        .executeTakeFirst();
      if (!updated) throw conflict('O evento já foi alterado ou cancelado.');
      await dismissEventAlerts(tx, row.id);
      await tx
        .deleteFrom('reminders')
        .where('event_id', '=', row.id)
        .where('status', '=', 'pending')
        .execute();
      return !row.external && row.organizer
        ? calendarEmail(
            tx,
            updated,
            c.userId,
            eventInvite(updated, 'CANCEL'),
            eventInput(row).attendees.map((a) => a.address),
          )
        : null;
    });
    await dispatch(mail);
    changed(c.userId);
    return { ok: true };
  });
  const invitation = async (req: import('fastify').FastifyRequest) => {
    const c = requireTenant(req.ctx),
      id = idOf(req.params);
    const message = await r.db
      .selectFrom('messages')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!message) throw notFound();
    await requireMailboxPerm(c, r.db, message.mailbox_id, 'read');
    await requireFolder(c, r.db, message.mailbox_id, message.folder_id);
    const parsed = calendarInviteSchema.safeParse(message.calendar_invite);
    if (!parsed.success) throw conflict('Convite inválido ou indisponível.');
    const preferences = parsed.data.floating
      ? await r.db
          .selectFrom('user_preferences')
          .select('timezone')
          .where('user_id', '=', c.userId)
          .executeTakeFirst()
      : null;
    return {
      c,
      message,
      invite: resolveCalendarInviteTimezone(
        parsed.data,
        preferences?.timezone ?? 'America/Sao_Paulo',
      ),
    };
  };
  app.get('/api/messages/:id/calendar', async (req) => {
    const { c, invite } = await invitation(req);
    const event = await r.db
      .selectFrom('calendar_events')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('uid', '=', invite.uid)
      .executeTakeFirst();
    return { invite, event };
  });
  app.post('/api/messages/:id/calendar/respond', async (req) => {
    const { c, message, invite } = await invitation(req);
    const { status } = z
      .object({ status: z.enum(['ACCEPTED', 'DECLINED', 'TENTATIVE']) })
      .parse(req.body);
    if (invite.method !== 'REQUEST' && invite.method !== 'PUBLISH')
      throw conflict('Este convite não aceita respostas.');
    const box =
        invite.method === 'PUBLISH'
          ? await r.db
              .selectFrom('mailboxes')
              .selectAll()
              .where('id', '=', message.mailbox_id)
              .where('tenant_id', '=', c.tenantId)
              .executeTakeFirstOrThrow()
          : await connected(c, message.mailbox_id),
      own = [box.email_address, ...box.aliases].map((a) => a.toLowerCase());
    if (invite.organizer && invite.organizer.toLowerCase() !== message.from_address.toLowerCase())
      throw conflict('O remetente não corresponde ao organizador.');
    const attendee = invite.attendees.find((a) => own.includes(a.address.toLowerCase()));
    if (!attendee && invite.method === 'REQUEST')
      throw conflict('A conta não está entre os participantes do convite.');
    const result = await r.db.transaction().execute(async (tx) => {
      const calendar = await ensureCalendar(tx, c.tenantId, c.userId);
      const old = await tx
        .selectFrom('calendar_events')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .where('uid', '=', invite.uid)
        .forUpdate()
        .executeTakeFirst();
      if (old && invite.method === 'PUBLISH') return { row: old, mail: null };
      if (
        old &&
        (!old.external ||
          (old.organizer ?? '') !== invite.organizer ||
          old.mailbox_id !== message.mailbox_id ||
          (invite.recurrence_id
            ? (eventInput(old).exceptions.find((ex) => ex.original === invite.recurrence_id)
                ?.sequence ?? old.schedule_sequence)
            : old.schedule_sequence) > invite.sequence)
      )
        throw conflict('Há uma versão mais recente ou um conflito com este compromisso.');
      if (invite.recurrence_id && (!old || !old.rrule))
        throw conflict('Adicione primeiro o convite da série para responder a esta ocorrência.');
      const oldException =
        invite.recurrence_id && old
          ? eventInput(old).exceptions.find((ex) => ex.original === invite.recurrence_id)
          : undefined;
      const previousAttendees = oldException?.attendees ?? (old ? eventInput(old).attendees : []);
      if (
        old &&
        previousAttendees.some(
          (a) =>
            own.includes(a.address) &&
            a.status === status &&
            a.response_sequence === invite.sequence,
        )
      )
        return { row: old, mail: null };
      const attendees = invite.attendees.map((a) =>
        own.includes(a.address)
          ? {
              ...a,
              status,
              response_sequence: invite.sequence,
              responded_at: new Date().toISOString(),
            }
          : a,
      );
      const values = {
        calendar_id: old?.calendar_id ?? calendar.id,
        mailbox_id: invite.method === 'PUBLISH' ? null : box.id,
        title: invite.title,
        description: invite.description,
        description_html: invite.description_html
          ? sanitizeEmailHtml(invite.description_html, invite.description)
          : '',
        meeting_url: invite.meeting_url,
        availability: invite.availability,
        category: invite.category,
        is_private: invite.is_private,
        location: invite.location,
        starts_at: new Date(invite.starts_at),
        ends_at: new Date(invite.ends_at),
        timezone: invite.timezone,
        timezone_definition: invite.timezone_definition,
        all_day: invite.all_day,
        organizer: invite.method === 'PUBLISH' ? null : invite.organizer,
        attendees: asJson(attendees),
        rrule: invite.rrule,
        exceptions: asJson(invite.exceptions),
        sequence: old ? old.sequence + 1 : 0,
        schedule_sequence: invite.sequence,
        external: invite.method !== 'PUBLISH',
        status: status === 'DECLINED' ? 'cancelled' : 'confirmed',
        reminder_minutes: status === 'DECLINED' ? null : 15,
        reminder_cursor: null,
        updated_at: new Date(),
      };
      const row =
        old && invite.recurrence_id
          ? await tx
              .updateTable('calendar_events')
              .set({
                exceptions: asJson([
                  ...eventInput(old).exceptions.filter(
                    (ex) => ex.original !== invite.recurrence_id,
                  ),
                  {
                    ...oldException,
                    original: invite.recurrence_id,
                    start: invite.starts_at,
                    end: invite.ends_at,
                    title: invite.title,
                    cancelled: status === 'DECLINED',
                    sequence: invite.sequence,
                    attendees,
                  },
                ]),
                sequence: old.sequence + 1,
                reminder_cursor: null,
                updated_at: new Date(),
              })
              .where('id', '=', old.id)
              .returningAll()
              .executeTakeFirstOrThrow()
          : old
            ? await tx
                .updateTable('calendar_events')
                .set(values)
                .where('id', '=', old.id)
                .returningAll()
                .executeTakeFirstOrThrow()
            : await tx
                .insertInto('calendar_events')
                .values({ ...values, tenant_id: c.tenantId, user_id: c.userId, uid: invite.uid })
                .returningAll()
                .executeTakeFirstOrThrow();
      await tx
        .deleteFrom('reminders')
        .where('event_id', '=', row.id)
        .where('status', '=', 'pending')
        .execute();
      if (status === 'DECLINED') await dismissEventAlerts(tx, row.id, invite.recurrence_id);
      return {
        row,
        mail:
          attendee && invite.method === 'REQUEST'
            ? await calendarEmail(
                tx,
                row,
                c.userId,
                { ...invite, method: 'REPLY', attendees: [{ ...attendee, status }] },
                [invite.organizer],
              )
            : null,
      };
    });
    await dispatch(result.mail);
    changed(c.userId);
    return result.row;
  });
  app.get('/api/reminders', async (req) => {
    const c = requireTenant(req.ctx),
      q = z
        .object({
          status: z.enum(['active', 'completed', 'all']).default('active'),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce
            .number()
            .int()
            .refine((v) => [10, 20, 30, 50, 100].includes(v))
            .default(10),
        })
        .parse(req.query);
    let query = r.db
      .selectFrom('reminders')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId);
    if (q.status === 'active') query = query.where('status', 'in', ['pending', 'notified']);
    else if (q.status === 'completed')
      query = query.where('status', 'in', ['completed', 'dismissed']);
    const count = await query
      .clearSelect()
      .select((eb) => eb.fn.countAll<string>().as('total'))
      .executeTakeFirstOrThrow();
    const total = Number(count.total),
      page = Math.min(q.page, Math.max(1, Math.ceil(total / q.pageSize)));
    const items = await query
      .orderBy('due_at')
      .orderBy('id')
      .limit(q.pageSize)
      .offset((page - 1) * q.pageSize)
      .execute();
    return { items, total, page, pageSize: q.pageSize };
  });
  app.post('/api/reminders', async (req) => {
    const c = requireTenant(req.ctx),
      body = reminderSchema.parse(req.body);
    const row = await r.db
      .insertInto('reminders')
      .values({
        ...body,
        due_at: new Date(body.due_at),
        recurrence: body.recurrence ? asJson(body.recurrence) : null,
        recurrence_start: body.recurrence ? new Date(body.due_at) : null,
        tenant_id: c.tenantId,
        user_id: c.userId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    changed(c.userId);
    return row;
  });
  app.patch('/api/reminders/:id', async (req) => {
    const c = requireTenant(req.ctx),
      id = idOf(req.params),
      body = reminderSchema.parse(req.body);
    const row = await r.db.transaction().execute(async (tx) => {
      const old = await tx
        .selectFrom('reminders')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!old) throw notFound();
      if (old.event_id) throw conflict('Edite o lembrete pelo compromisso.');
      if (!['pending', 'notified'].includes(old.status))
        throw conflict('Este lembrete já foi concluído.');
      if (old.notification_id)
        await tx
          .updateTable('notifications')
          .set({ read_at: new Date() })
          .where('id', '=', old.notification_id)
          .where('user_id', '=', c.userId)
          .execute();
      // Editing a recurring task replaces future pending repetitions atomically.
      await tx
        .updateTable('reminders')
        .set({ status: 'dismissed', recurrence: null })
        .where('series_id', '=', old.series_id)
        .where('id', '!=', old.id)
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .where('status', '=', 'pending')
        .execute();
      return tx
        .updateTable('reminders')
        .set({
          ...body,
          due_at: new Date(body.due_at),
          recurrence: body.recurrence ? asJson(body.recurrence) : null,
          recurrence_start: body.recurrence ? new Date(body.due_at) : null,
          series_id: randomUUID(),
          recurrence_index: 0,
          status: 'pending',
          notification_id: null,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    changed(c.userId);
    return row;
  });
  app.post('/api/reminders/:id/action', async (req) => {
    const c = requireTenant(req.ctx),
      id = idOf(req.params),
      body = z
        .object({
          action: z.enum(['snooze', 'dismiss', 'complete', 'stop']),
          minutes: z.number().int().min(1).max(525600).default(15),
        })
        .parse(req.body);
    const row = await r.db.transaction().execute(async (tx) => {
      const old = await tx
        .selectFrom('reminders')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .where('id', '=', id)
        .forUpdate()
        .executeTakeFirst();
      if (!old) throw notFound();
      if (body.action === 'stop') {
        await tx
          .updateTable('reminders')
          .set({ status: 'dismissed', recurrence: null, updated_at: new Date() })
          .where('series_id', '=', old.series_id)
          .where('tenant_id', '=', c.tenantId)
          .where('user_id', '=', c.userId)
          .where('status', 'in', ['pending', 'notified'])
          .execute();
        return old;
      }
      if (['completed', 'dismissed'].includes(old.status)) return old;
      if (old.status === 'pending' && ['complete', 'dismiss'].includes(body.action))
        await continueReminder(tx, old, new Date(Math.max(Date.now(), +old.due_at)));
      if (old.notification_id)
        await tx
          .updateTable('notifications')
          .set({ read_at: new Date() })
          .where('id', '=', old.notification_id)
          .where('user_id', '=', c.userId)
          .execute();
      return tx
        .updateTable('reminders')
        .set({
          status:
            body.action === 'snooze'
              ? 'pending'
              : body.action === 'complete'
                ? 'completed'
                : 'dismissed',
          ...(body.action === 'snooze'
            ? {
                due_at: new Date(Date.now() + body.minutes * 60000),
                ...(old.status === 'notified' ? { recurrence: null } : {}),
                notification_id: null,
              }
            : {}),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
    changed(c.userId);
    return row;
  });
}
