import { useState } from 'react';
import { ZodError } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  calendarEventSchema,
  calendarInstant,
  calendarLocalInput,
  type CalendarEventInput,
  type InvitationEmailPreferences,
  type MeetIntegrationStatus,
} from '@apmail/shared';
import { api } from '@/lib/api';
import { useTenantId, canMailbox, type Mailbox } from '@/lib/auth';
import type { UserCalendar, CalendarEvent } from '@/lib/calendar';
import { reminderOptions } from '@/lib/calendar';
import { RecurrenceFields } from './recurrence-fields';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/forms/rich-text-editor';
import { EventSchedule } from './event-schedule';
import { OnlineMeeting } from './online-meeting';
import { TimezoneSelect } from '@/components/forms/timezone-select';
import { EmailChipInput } from '@/components/mail/email-chip-input';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import {
  Trash2,
  CalendarDays,
  Download,
  Send,
  UsersRound,
  MapPin,
  ChevronDown,
} from 'lucide-react';

export function EventEditor({
  calendars,
  event,
  start,
  end,
  allDay = false,
  original,
  timezone,
  onClose,
}: {
  calendars: UserCalendar[];
  event?: CalendarEvent;
  start: string;
  end: string;
  allDay?: boolean;
  original?: string;
  timezone: string;
  onClose: () => void;
}) {
  const tenant = useTenantId(),
    client = useQueryClient();
  const boxes = useQuery({
    queryKey: ['mailboxes', tenant],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
  });
  const emailPreferences = useQuery({
    queryKey: ['invitation-email-preferences', tenant],
    queryFn: () => api<InvitationEmailPreferences>('/calendar/email-preferences'),
  });
  const [mailboxTouched, setMailboxTouched] = useState(false);
  const google = useQuery({
    queryKey: ['google-integration', tenant],
    queryFn: () => api<MeetIntegrationStatus>('/integrations/google'),
  });
  const [draftForm, setForm] = useState<CalendarEventInput>(() =>
    event
      ? {
          ...event,
          title: original
            ? (event.exceptions.find((ex) => ex.original === original)?.title ?? event.title)
            : event.title,
        }
      : {
          calendar_id: calendars[0]?.id ?? '',
          mailbox_id: null,
          title: '',
          description: '',
          description_html: '',
          meeting_url: null,
          availability: 'busy',
          location: '',
          starts_at: start,
          ends_at: end,
          timezone,
          timezone_definition: null,
          all_day: allDay,
          is_private: false,
          category: '',
          color: null,
          attendees: [],
          rrule: null,
          exceptions: [],
          reminder_minutes: 15,
        },
  );
  const available = boxes.data?.filter((b) => canMailbox(b, 'send') && b.status === 'active') ?? [];
  const preferred =
    available.find(
      (b) => !!draftForm.meeting_url && b.id === google.data?.preferences.mailbox_id,
    ) ??
    available.find((b) => b.id === emailPreferences.data?.mailbox_id) ??
    (available.length === 1 ? available[0] : undefined);
  const form =
    !event && !mailboxTouched && !draftForm.mailbox_id
      ? { ...draftForm, mailbox_id: preferred?.id ?? null }
      : draftForm;
  const [localStart, setLocalStart] = useState(
    calendarLocalInput(original ? start : form.starts_at, form.timezone),
  );
  const [localEnd, setLocalEnd] = useState(
    calendarLocalInput(original ? end : form.ends_at, form.timezone),
  );
  const [scope, setScope] = useState<'series' | 'occurrence'>(
    event?.rrule && original ? 'occurrence' : 'series',
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [deleting, setDeleting] = useState(false),
    [customReminder, setCustomReminder] = useState(
      form.reminder_minutes !== null &&
        !reminderOptions.some((o) => o.value === String(form.reminder_minutes)),
    );
  const [optionalOpen, setOptionalOpen] = useState(
    !!event?.attendees.some((a) => a.role === 'optional'),
  );
  const [sendUpdates, setSendUpdates] = useState(true);
  const update = <K extends keyof CalendarEventInput>(key: K, value: CalendarEventInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const readonly = event?.external;
  const shownAttendees =
    scope === 'occurrence' && original
      ? (event?.exceptions.find((ex) => ex.original === original)?.attendees ?? event?.attendees)
      : event?.attendees;
  const persist = async () => {
    if (busy) return;
    setError('');
    try {
      if (readonly && event) {
        setBusy(true);
        await api('/calendar/events/' + event.id + '/preferences', {
          method: 'PATCH',
          body: {
            calendar_id: form.calendar_id,
            reminder_minutes: form.reminder_minutes,
            is_private: form.is_private,
            color: form.color,
            category: form.category,
            version: event.sequence,
          },
        });
        await client.invalidateQueries({ queryKey: ['calendar'] });
        toast.success('Preferências do compromisso salvas.');
        onClose();
        return;
      }
      const value = calendarEventSchema.parse({
        ...form,
        starts_at: calendarInstant(
          form.all_day ? localStart.slice(0, 10) + 'T00:00' : localStart,
          form.timezone,
        ),
        ends_at: calendarInstant(
          form.all_day ? localEnd.slice(0, 10) + 'T00:00' : localEnd,
          form.timezone,
        ),
      });
      setBusy(true);
      if (event && scope === 'occurrence')
        await api('/calendar/events/' + event.id + '/occurrence', {
          method: 'POST',
          body: {
            original,
            start: value.starts_at,
            end: value.ends_at,
            title: value.title,
            cancelled: false,
            version: event.sequence,
          },
        });
      else
        await api('/calendar/events' + (event ? '/' + event.id : ''), {
          method: event ? 'PATCH' : 'POST',
          body: { ...value, version: event?.sequence, send_invitations: sendUpdates },
        });
      await client.invalidateQueries({ queryKey: ['calendar'] });
      toast.success(
        form.attendees.length && sendUpdates
          ? 'Reunião salva e convites na fila de envio.'
          : 'Compromisso salvo.',
      );
      onClose();
    } catch (e) {
      setError(
        e instanceof ZodError
          ? (e.issues[0]?.message ?? 'Confira os campos do compromisso.')
          : e instanceof Error
            ? e.message
            : 'Confira os campos do compromisso.',
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!event) return;
    setBusy(true);
    setError('');
    try {
      if (scope === 'occurrence')
        await api('/calendar/events/' + event.id + '/occurrence', {
          method: 'POST',
          body: { original, cancelled: true, version: event.sequence },
        });
      else
        await api('/calendar/events/' + event.id, {
          method: 'DELETE',
          body: { version: event.sequence },
        });
      await client.invalidateQueries({ queryKey: ['calendar'] });
      toast.success('Compromisso cancelado.');
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      setDeleting(false);
    }
  };
  const field = 'h-10 w-full rounded-md border border-input bg-card px-3 text-sm';
  const whole = scope !== 'occurrence' || readonly;
  const recipients = (role: 'required' | 'optional', values: { name: string; address: string }[]) =>
    update('attendees', [
      ...form.attendees.filter(
        (a) =>
          (a.role ?? 'required') !== role &&
          !values.some((value) => value.address.toLowerCase() === a.address.toLowerCase()),
      ),
      ...values.map((a) => ({
        ...form.attendees.find((old) => old.address === a.address),
        ...a,
        role,
        status: form.attendees.find((old) => old.address === a.address)?.status ?? 'NEEDS-ACTION',
      })),
    ]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[94dvh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
        showCloseButton={!busy}
      >
        <DialogHeader className="shrink-0 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="size-5 text-primary" />
            {event ? 'Detalhes do compromisso' : 'Novo compromisso'}
          </DialogTitle>
          <DialogDescription>
            {readonly
              ? 'Organizado por ' + (event.organizer ?? 'outro participante')
              : 'Organize o compromisso e envie o convite pela sua caixa de e-mail.'}
          </DialogDescription>
        </DialogHeader>
        <form
          id="calendar-event-form"
          className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            void persist();
          }}
        >
          {event?.rrule && original && (
            <label className="flex flex-wrap items-center gap-3 text-sm">
              Alterar
              <select
                aria-label="Alterar"
                className={field + ' max-w-64'}
                value={scope}
                disabled={readonly || busy}
                onChange={(e) => {
                  const next = e.target.value as 'series' | 'occurrence';
                  setScope(next);
                  update(
                    'title',
                    next === 'series'
                      ? event.title
                      : (event.exceptions.find((ex) => ex.original === original)?.title ??
                          event.title),
                  );
                  setLocalStart(
                    calendarLocalInput(next === 'series' ? event.starts_at : start, form.timezone),
                  );
                  setLocalEnd(
                    calendarLocalInput(next === 'series' ? event.ends_at : end, form.timezone),
                  );
                }}
              >
                <option value="occurrence">Somente esta ocorrência</option>
                <option value="series">Toda a série</option>
              </select>
            </label>
          )}
          {whole && !readonly && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-xs text-muted-foreground">
                De
                <select
                  aria-label="Conta organizadora"
                  className={field + ' text-foreground'}
                  disabled={busy || !!event?.organizer}
                  value={form.mailbox_id ?? ''}
                  onChange={(e) => {
                    setMailboxTouched(true);
                    update('mailbox_id', e.target.value || null);
                  }}
                >
                  <option value="">Escolher conta para enviar convites</option>
                  {boxes.data
                    ?.filter((b) => canMailbox(b, 'send') && b.status === 'active')
                    .map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} · {b.email_address}
                      </option>
                    ))}
                </select>
              </label>
              <label className="space-y-1 text-xs text-muted-foreground">
                Calendário
                <select
                  aria-label="Calendário"
                  className={field + ' text-foreground'}
                  value={form.calendar_id}
                  disabled={busy}
                  onChange={(e) => update('calendar_id', e.target.value)}
                >
                  {calendars.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
          <fieldset disabled={busy || readonly} className="min-w-0 space-y-5 disabled:opacity-90">
            <div>
              <Label htmlFor="event-title" className="sr-only">
                Título
              </Label>
              <Input
                id="event-title"
                required
                maxLength={300}
                value={form.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder="Adicionar um título"
                autoFocus
                className="h-12 rounded-none border-0 border-b bg-transparent px-0 text-xl font-semibold shadow-none md:text-xl"
              />
            </div>
            {whole && !readonly && (
              <section aria-label="Convidados" className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="flex items-center gap-2 text-sm font-medium">
                    <UsersRound className="size-4 text-muted-foreground" />
                    Participantes
                  </h3>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setOptionalOpen(!optionalOpen)}
                  >
                    {optionalOpen ? 'Ocultar opcionais' : 'Adicionar opcionais'}
                  </Button>
                </div>
                {form.mailbox_id ? (
                  <>
                    <EmailChipInput
                      label="Participantes obrigatórios"
                      compact={false}
                      mailboxId={form.mailbox_id}
                      value={form.attendees.filter((a) => a.role !== 'optional')}
                      onChange={(values) => recipients('required', values)}
                    />
                    {optionalOpen && (
                      <EmailChipInput
                        label="Participantes opcionais"
                        compact={false}
                        mailboxId={form.mailbox_id}
                        value={form.attendees.filter((a) => a.role === 'optional')}
                        onChange={(values) => recipients('optional', values)}
                      />
                    )}
                  </>
                ) : (
                  <p className="rounded-md border border-dashed px-3 py-3 text-xs text-muted-foreground">
                    Escolha a conta no campo De para adicionar participantes e enviar convites.
                  </p>
                )}
              </section>
            )}
            <EventSchedule
              start={localStart}
              end={localEnd}
              onChange={(start, end) => {
                setLocalStart(start);
                setLocalEnd(end);
              }}
              timezone={form.timezone}
              allDay={form.all_day}
              onAllDayChange={(value) => update('all_day', value)}
              disabled={busy || readonly}
              allowAllDay={scope !== 'occurrence'}
            />
            {whole && (
              <>
                <div className="relative">
                  <MapPin className="absolute left-3 top-3 size-4 text-muted-foreground" />
                  <Label htmlFor="event-location" className="sr-only">
                    Localização
                  </Label>
                  <Input
                    id="event-location"
                    className="h-10 pl-9"
                    placeholder="Adicionar local ou sala"
                    maxLength={500}
                    value={form.location}
                    onChange={(e) => update('location', e.target.value)}
                  />
                </div>
              </>
            )}
          </fieldset>
          {whole && (
            <section
              aria-label="Configuração do lembrete"
              className="flex flex-wrap items-end gap-3 rounded-md bg-muted/40 p-3"
            >
              {' '}
              <label className="space-y-1 text-xs">
                Exibir pop-up de lembrete
                <select
                  aria-label="Antecedência do lembrete"
                  disabled={busy}
                  className={field}
                  value={
                    customReminder
                      ? 'custom'
                      : form.reminder_minutes === null
                        ? ''
                        : String(form.reminder_minutes)
                  }
                  onChange={(e) => {
                    setCustomReminder(e.target.value === 'custom');
                    if (e.target.value !== 'custom')
                      update(
                        'reminder_minutes',
                        e.target.value === '' ? null : Number(e.target.value),
                      );
                  }}
                >
                  {reminderOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {customReminder && (
                <label className="space-y-1 text-xs">
                  Minutos antes
                  <Input
                    type="number"
                    disabled={busy}
                    min={0}
                    max={525600}
                    value={form.reminder_minutes ?? 15}
                    onChange={(e) => update('reminder_minutes', Number(e.target.value))}
                  />
                </label>
              )}
              <p className="max-w-xs pb-2 text-xs text-muted-foreground">
                O pop-up aparecerá neste horário antes do compromisso, em qualquer seção do APMail.
              </p>
            </section>
          )}
          {whole && (
            <OnlineMeeting
              eventId={event?.id}
              eventStart={original ? start : event?.starts_at}
              value={form.meeting_url}
              onChange={(value) => update('meeting_url', value)}
              disabled={busy}
              readonly={readonly}
            />
          )}
          {whole && (
            <div className="space-y-2">
              <h3 className="text-sm font-medium">Pauta e observações (opcional)</h3>
              {!readonly && (
                <p className="text-xs text-muted-foreground">
                  O e-mail do convite é montado automaticamente com o padrão e a assinatura
                  definidos em Preferências.
                </p>
              )}
              {readonly ? (
                <div className="rounded-md border p-3 text-sm">
                  {form.description_html ? (
                    <div dangerouslySetInnerHTML={{ __html: form.description_html }} />
                  ) : (
                    <p className="whitespace-pre-wrap">{form.description || 'Sem descrição.'}</p>
                  )}
                </div>
              ) : (
                <RichTextEditor
                  compact
                  label="Descrição do compromisso"
                  value={
                    form.description_html ||
                    '<p>' +
                      form.description
                        .replaceAll('&', '&amp;')
                        .replaceAll('<', '&lt;')
                        .replaceAll('\n', '<br>') +
                      '</p>'
                  }
                  onChange={(value) => update('description_html', value)}
                />
              )}
            </div>
          )}
          {whole && (
            <details className="group rounded-lg border" open={customReminder || undefined}>
              <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-3 text-sm font-medium">
                Opções do compromisso
                <ChevronDown className="size-4 text-muted-foreground group-open:rotate-180" />
              </summary>
              <div className="grid gap-4 border-t p-3 sm:grid-cols-2">
                {!readonly && (
                  <label className="space-y-1 text-xs">
                    Disponibilidade
                    <select
                      aria-label="Disponibilidade"
                      className={field}
                      disabled={busy}
                      value={form.availability}
                      onChange={(e) =>
                        update('availability', e.target.value as CalendarEventInput['availability'])
                      }
                    >
                      <option value="busy">Ocupado</option>
                      <option value="free">Livre</option>
                      <option value="tentative">Provisório</option>
                      <option value="out_of_office">Fora do escritório</option>
                    </select>
                  </label>
                )}
                {!readonly && (
                  <div>
                    <p className="mb-1 text-xs">Fuso horário</p>
                    <TimezoneSelect
                      id="event-timezone"
                      value={form.timezone}
                      onChange={(value) => {
                        update('timezone', value);
                        update('timezone_definition', null);
                      }}
                    />
                  </div>
                )}
                {readonly && (
                  <label className="space-y-1 text-xs">
                    Calendário
                    <select
                      aria-label="Calendário"
                      className={field}
                      disabled={busy}
                      value={form.calendar_id}
                      onChange={(e) => update('calendar_id', e.target.value)}
                    >
                      {calendars.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label className="space-y-1 text-xs">
                  Categoria
                  <Input
                    maxLength={100}
                    disabled={busy}
                    value={form.category}
                    onChange={(e) => update('category', e.target.value)}
                  />
                </label>
                <label className="flex items-center gap-3 text-xs">
                  Cor
                  <Input
                    type="color"
                    className="w-14"
                    disabled={busy}
                    value={
                      form.color ??
                      calendars.find((c) => c.id === form.calendar_id)?.color ??
                      '#1686A7'
                    }
                    onChange={(e) => update('color', e.target.value)}
                  />
                </label>
                <label className="flex min-h-10 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={form.is_private}
                    onChange={(e) => update('is_private', e.target.checked)}
                  />
                  Evento privado
                </label>
                {!readonly && (
                  <div className="sm:col-span-2">
                    <RecurrenceFields
                      value={form.rrule}
                      onChange={(value) => update('rrule', value)}
                      timezone={form.timezone}
                    />
                  </div>
                )}
              </div>
            </details>
          )}
          {!!shownAttendees?.length && (
            <section className="rounded-lg border p-3">
              <h3 className="mb-2 text-sm font-medium">Respostas dos participantes</h3>
              <ul className="divide-y">
                {shownAttendees.map((a) => (
                  <li
                    key={a.address}
                    className="flex flex-wrap items-center justify-between gap-2 py-2 text-xs"
                  >
                    <span className="min-w-0">
                      <span className="font-medium">{a.name || a.address}</span>
                      {a.name && <span className="ml-2 text-muted-foreground">{a.address}</span>}
                      {a.role === 'optional' && (
                        <span className="ml-2 text-muted-foreground">Opcional</span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {
                        {
                          ACCEPTED: 'Aceitou',
                          DECLINED: 'Recusou',
                          TENTATIVE: 'Talvez',
                          'NEEDS-ACTION': 'Aguardando resposta',
                        }[a.status]
                      }
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {event && !readonly && !!form.attendees.length && (
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={sendUpdates}
                onChange={(e) => setSendUpdates(e.target.checked)}
                disabled={busy}
              />
              Enviar atualização aos participantes
            </label>
          )}
          {error && (
            <p
              role="alert"
              className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            >
              {error}
            </p>
          )}
        </form>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-card px-5 py-3">
          <div className="flex gap-1">
            {event && (
              <>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() => setDeleting(true)}
                >
                  <Trash2 />
                  Cancelar evento
                </Button>
                <Button asChild type="button" variant="ghost" size="sm">
                  <a href={'/api/calendar/events/' + event.id + '/ics'} download>
                    <Download />
                    ICS
                  </a>
                </Button>
              </>
            )}
          </div>
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Fechar
            </Button>
            <Button disabled={busy} form="calendar-event-form" type="submit">
              {!readonly && !!form.attendees.length && sendUpdates && <Send />}
              {busy
                ? 'Salvando…'
                : readonly
                  ? 'Salvar preferências'
                  : form.attendees.length && sendUpdates
                    ? event
                      ? 'Enviar atualização'
                      : 'Enviar convite'
                    : 'Salvar'}
            </Button>
          </div>
        </footer>
        <ConfirmDialog
          open={deleting}
          onOpenChange={setDeleting}
          title={scope === 'occurrence' ? 'Cancelar esta ocorrência?' : 'Cancelar compromisso?'}
          description="Os participantes serão avisados por e-mail quando você for o organizador."
          onConfirm={remove}
          pending={busy}
          destructive
        />
      </DialogContent>
    </Dialog>
  );
}
