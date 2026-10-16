import { useState } from 'react';
import { ZodError } from 'zod';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  calendarEventSchema,
  calendarInstant,
  calendarLocalInput,
  type CalendarEventInput,
  type CalendarAttendee,
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
import { Textarea } from '@/components/ui/textarea';
import { TimezoneSelect } from '@/components/forms/timezone-select';
import { EmailChipInput } from '@/components/mail/email-chip-input';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Trash2, CalendarDays, Download } from 'lucide-react';

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
  const [form, setForm] = useState<CalendarEventInput>(() =>
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
          body: { ...value, version: event?.sequence, send_invitations: true },
        });
      await client.invalidateQueries({ queryKey: ['calendar'] });
      toast.success(
        form.attendees.length ? 'Reunião salva e convites na fila de envio.' : 'Compromisso salvo.',
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!busy}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarDays className="size-5 text-primary" />
            {event ? 'Detalhes do compromisso' : 'Novo compromisso'}
          </DialogTitle>
          <DialogDescription>
            {readonly
              ? 'Evento gerenciado pelo organizador. As respostas são enviadas pelo convite na caixa de entrada.'
              : 'Organize seu tempo e convide participantes por e-mail.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void persist();
          }}
        >
          {event?.rrule && original && (
            <label className="block space-y-1 text-sm">
              Alterar
              <select
                aria-label="Alterar"
                className={field}
                value={scope}
                disabled={readonly || busy}
                onChange={(e) => {
                  const scope = e.target.value as 'series' | 'occurrence';
                  setScope(scope);
                  if (scope === 'series') {
                    update('title', event.title);
                    setLocalStart(calendarLocalInput(event.starts_at, form.timezone));
                    setLocalEnd(calendarLocalInput(event.ends_at, form.timezone));
                  } else {
                    update(
                      'title',
                      event.exceptions.find((ex) => ex.original === original)?.title ?? event.title,
                    );
                    setLocalStart(calendarLocalInput(start, form.timezone));
                    setLocalEnd(calendarLocalInput(end, form.timezone));
                  }
                }}
              >
                <option value="occurrence">Somente esta ocorrência</option>
                <option value="series">Toda a série</option>
              </select>
            </label>
          )}
          <fieldset disabled={busy || readonly} className="space-y-4 disabled:opacity-80">
            <div className="space-y-1">
              <Label htmlFor="event-title">Título</Label>
              <Input
                id="event-title"
                required
                maxLength={300}
                value={form.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder="Adicionar um título"
                autoFocus
              />
            </div>
            {(scope !== 'occurrence' || readonly) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-sm">
                  Calendário
                  <select
                    className={field}
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
                <label className="space-y-1 text-sm">
                  Fuso horário
                  <TimezoneSelect
                    id="event-timezone"
                    value={form.timezone}
                    onChange={(value) => {
                      update('timezone', value);
                      update('timezone_definition', null);
                    }}
                  />
                </label>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">
                Início
                <Input
                  aria-label="Início"
                  type={form.all_day ? 'date' : 'datetime-local'}
                  required
                  value={form.all_day ? localStart.slice(0, 10) : localStart}
                  onChange={(e) => setLocalStart(e.target.value)}
                />
              </label>
              <label className="space-y-1 text-sm">
                Término{form.all_day ? ' (dia seguinte ao último dia)' : ''}
                <Input
                  aria-label="Término"
                  type={form.all_day ? 'date' : 'datetime-local'}
                  required
                  value={form.all_day ? localEnd.slice(0, 10) : localEnd}
                  onChange={(e) => setLocalEnd(e.target.value)}
                />
              </label>
            </div>
            {(scope !== 'occurrence' || readonly) && (
              <>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex min-h-8 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.all_day}
                      onChange={(e) => update('all_day', e.target.checked)}
                    />
                    Dia inteiro
                  </label>
                  <label className="flex min-h-8 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={form.is_private}
                      onChange={(e) => update('is_private', e.target.checked)}
                    />
                    Privado
                  </label>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="event-location">Localização</Label>
                  <Input
                    id="event-location"
                    maxLength={500}
                    value={form.location}
                    onChange={(e) => update('location', e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <RecurrenceFields
                    value={form.rrule}
                    onChange={(value) => update('rrule', value)}
                    timezone={form.timezone}
                    disabled={scope === 'occurrence'}
                  />
                  <label className="space-y-1 text-sm">
                    Lembrete
                    <select
                      aria-label="Antecedência do lembrete"
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
                </div>
                {customReminder && (
                  <label className="block space-y-1 text-sm">
                    Minutos antes
                    <Input
                      type="number"
                      min={0}
                      max={525600}
                      value={form.reminder_minutes ?? 15}
                      onChange={(e) => update('reminder_minutes', Number(e.target.value))}
                    />
                  </label>
                )}
                <details className="rounded-md border p-3" open={!!form.attendees.length}>
                  <summary className="cursor-pointer text-sm font-medium">
                    Participantes e conta organizadora
                  </summary>
                  <div className="mt-3 space-y-3">
                    <label className="block space-y-1 text-sm">
                      Enviar convites por
                      <select
                        aria-label="Conta organizadora"
                        className={field}
                        value={form.mailbox_id ?? ''}
                        onChange={(e) => update('mailbox_id', e.target.value || null)}
                      >
                        <option value="">Sem envio de convites</option>
                        {boxes.data
                          ?.filter((b) => canMailbox(b, 'send') && b.status === 'active')
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name} · {b.email_address}
                            </option>
                          ))}
                      </select>
                    </label>
                    {form.mailbox_id && (
                      <EmailChipInput
                        label="Participantes"
                        mailboxId={form.mailbox_id}
                        value={form.attendees}
                        onChange={(v) =>
                          update(
                            'attendees',
                            v.map(
                              (a) =>
                                ({
                                  ...a,
                                  status:
                                    form.attendees.find((old) => old.address === a.address)
                                      ?.status ?? 'NEEDS-ACTION',
                                }) as CalendarAttendee,
                            ),
                          )
                        }
                      />
                    )}
                    <p className="text-xs text-muted-foreground">
                      Ao salvar, novos convites ou atualizações são enviados pela conta selecionada.
                    </p>
                  </div>
                </details>
                <div className="grid grid-cols-[1fr_auto] gap-3">
                  <label className="space-y-1 text-sm">
                    Categoria
                    <Input
                      maxLength={100}
                      value={form.category}
                      onChange={(e) => update('category', e.target.value)}
                    />
                  </label>
                  <label className="space-y-1 text-sm">
                    Cor
                    <Input
                      type="color"
                      className="w-16"
                      value={
                        form.color ??
                        calendars.find((c) => c.id === form.calendar_id)?.color ??
                        '#1686A7'
                      }
                      onChange={(e) => update('color', e.target.value)}
                    />
                  </label>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="event-description">Descrição</Label>
                  <Textarea
                    id="event-description"
                    maxLength={20000}
                    rows={4}
                    value={form.description}
                    onChange={(e) => update('description', e.target.value)}
                  />
                </div>
              </>
            )}
          </fieldset>
          {readonly && (
            <fieldset disabled={busy} className="space-y-3 rounded-md border p-3">
              <legend className="px-1 text-sm font-medium">Suas preferências</legend>
              <label className="block space-y-1 text-sm">
                Calendário pessoal
                <select
                  className={field}
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
              <label className="block space-y-1 text-sm">
                Seu lembrete
                <select
                  aria-label="Seu lembrete"
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
                <label className="block space-y-1 text-sm">
                  Minutos antes
                  <Input
                    type="number"
                    min={0}
                    max={525600}
                    value={form.reminder_minutes ?? 15}
                    onChange={(e) => update('reminder_minutes', Number(e.target.value))}
                  />
                </label>
              )}
              <p className="text-xs text-muted-foreground">
                Estas preferências valem para o seu calendário e os seus lembretes.
              </p>
            </fieldset>
          )}
          {!!shownAttendees?.length && (
            <div className="space-y-1 text-xs text-muted-foreground">
              {shownAttendees.map((a) => (
                <p key={a.address}>
                  {a.name || a.address} ·{' '}
                  {
                    {
                      ACCEPTED: 'Aceitou',
                      DECLINED: 'Recusou',
                      TENTATIVE: 'Tentativa',
                      'NEEDS-ACTION': 'Aguardando resposta',
                    }[a.status]
                  }
                </p>
              ))}
            </div>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
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
                    Cancelar
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
            <div className="flex gap-2">
              <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
                Fechar
              </Button>
              {
                <Button disabled={busy} type="submit">
                  {busy
                    ? 'Salvando…'
                    : readonly
                      ? 'Salvar preferências'
                      : form.attendees.length
                        ? 'Salvar e enviar'
                        : 'Salvar'}
                </Button>
              }
            </div>
          </div>
        </form>
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
