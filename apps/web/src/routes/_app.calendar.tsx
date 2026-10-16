import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import FullCalendar from '@fullcalendar/react';
import dayGridPlugin from '@fullcalendar/daygrid';
import timeGridPlugin from '@fullcalendar/timegrid';
import listPlugin from '@fullcalendar/list';
import interactionPlugin from '@fullcalendar/interaction';
import luxonPlugin from '@fullcalendar/luxon3';
import ptBr from '@fullcalendar/core/locales/pt-br';
import type { EventDropArg, DatesSetArg } from '@fullcalendar/core';
import type { EventResizeDoneArg } from '@fullcalendar/interaction';
import { CalendarDays, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId, meQuery } from '@/lib/auth';
import type { UserCalendar, CalendarEvent, Occurrence } from '@/lib/calendar';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { EventEditor } from '@/components/calendar/event-editor';
import { ErrorState } from '@/components/data/data-state';
import { useMediaQuery } from '@/hooks/use-media-query';
export const Route = createFileRoute('/_app/calendar')({ component: CalendarPage });
type Editing = {
  event?: CalendarEvent;
  start: string;
  end: string;
  allDay: boolean;
  original?: string;
};
const calendarPlugins = [dayGridPlugin, timeGridPlugin, listPlugin, interactionPlugin, luxonPlugin];
const calendarViews = { workWeek: { type: 'timeGridWeek', hiddenDays: [0, 6] } };
function CalendarPage() {
  const tenant = useTenantId(),
    client = useQueryClient(),
    me = useQuery(meQuery),
    calendar = useRef<FullCalendar>(null);
  const desktop = useMediaQuery('(min-width: 1024px)');
  const calendars = useQuery({
    queryKey: ['calendar', tenant, 'calendars'],
    queryFn: () => api<UserCalendar[]>('/calendars'),
  });
  const [range, setRange] = useState({
    from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
    to: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 8).toISOString(),
  });
  const [title, setTitle] = useState('Calendário'),
    [view, setView] = useState(desktop ? 'timeGridWeek' : 'dayGridMonth'),
    [selectedDate, setSelectedDate] = useState(new Date());
  const [search, setSearch] = useState(''),
    [filter, setFilter] = useState(''),
    [type, setType] = useState('all'),
    [editing, setEditing] = useState<Editing | null>(null),
    [loading, setLoading] = useState(false);
  const [newCalendar, setNewCalendar] = useState(false),
    [name, setName] = useState(''),
    [color, setColor] = useState('#1686A7'),
    [saving, setSaving] = useState(false),
    [calendarError, setCalendarError] = useState('');
  const timezone = me.data?.preferences.timezone ?? 'America/Sao_Paulo';
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const datesChanged = useCallback((info: DatesSetArg) => {
    const next = { from: info.start.toISOString(), to: info.end.toISOString() };
    setRange((previous) =>
      previous.from === next.from && previous.to === next.to ? previous : next,
    );
    setTitle(info.view.title);
  }, []);
  const events = useQuery({
    queryKey: ['calendar', tenant, 'events', range, debouncedSearch, filter, type],
    queryFn: () =>
      api<Occurrence[]>(
        '/calendar/events?' +
          new URLSearchParams({
            ...range,
            search: debouncedSearch,
            type,
            ...(filter ? { calendar_id: filter } : {}),
          }),
      ),
    placeholderData: keepPreviousData,
  });
  const visibleEvents = useMemo(
    () =>
      events.data?.map((event) => {
        const rgb = event.color.replace('#', '');
        const channels = [0, 2, 4].map((offset) => {
          const value = parseInt(rgb.slice(offset, offset + 2), 16) / 255;
          return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
        });
        const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
        return { ...event, textColor: luminance > 0.179 ? '#000000' : '#FFFFFF' };
      }) ?? [],
    [events.data],
  );
  const create = (
    start = new Date().toISOString(),
    end = new Date(Date.now() + 3600000).toISOString(),
    allDay = false,
  ) => {
    if (calendars.data?.length) setEditing({ start, end, allDay });
  };
  const move = async (info: EventDropArg | EventResizeDoneArg) => {
    try {
      const event = await api<CalendarEvent>(
        '/calendar/events/' + String(info.event.extendedProps.event_id),
      );
      const start = info.event.start?.toISOString(),
        end = info.event.end?.toISOString();
      if (!start || !end) throw new Error('Duração inválida.');
      if (event.rrule)
        await api('/calendar/events/' + event.id + '/occurrence', {
          method: 'POST',
          body: {
            original: info.event.extendedProps.original,
            start,
            end,
            cancelled: false,
            version: event.sequence,
          },
        });
      else
        await api('/calendar/events/' + event.id, {
          method: 'PATCH',
          body: {
            ...event,
            starts_at: start,
            ends_at: end,
            all_day: info.event.allDay,
            version: event.sequence,
            send_invitations: true,
          },
        });
      await client.invalidateQueries({ queryKey: ['calendar'] });
      toast.success('Horário atualizado.');
    } catch (e) {
      info.revert();
      toast.error((e as Error).message);
    }
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Calendário</h1>
          <p className="text-xs text-muted-foreground">
            Compromissos, reuniões e lembretes · {timezone}
          </p>
        </div>
        <Button disabled={!calendars.data?.length || loading} onClick={() => create()}>
          <Plus />
          Novo compromisso
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card lg:flex-row">
        <aside className="hidden w-72 shrink-0 overflow-auto border-r p-3 lg:block">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(date) => {
              if (date) {
                setSelectedDate(date);
                calendar.current?.getApi().gotoDate(date);
              }
            }}
            className="w-full bg-card p-0 [--cell-size:--spacing(7)]"
          />
          <div className="mt-6 flex items-center justify-between">
            <h2 className="text-xs font-semibold">Meus calendários</h2>
            <Button
              aria-label="Criar calendário"
              size="icon"
              variant="ghost"
              className="size-8"
              onClick={() => setNewCalendar(true)}
            >
              <Plus />
            </Button>
          </div>
          <div className="mt-2 space-y-1">
            <button
              onClick={() => setFilter('')}
              className={
                'min-h-9 w-full rounded-md px-2 text-left text-sm ' +
                (!filter ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')
              }
            >
              Todos os calendários
            </button>
            {calendars.data?.map((c) => (
              <button
                key={c.id}
                onClick={() => setFilter(c.id)}
                className={
                  'flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left text-sm ' +
                  (filter === c.id ? 'bg-accent text-accent-foreground' : 'hover:bg-muted')
                }
              >
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: c.color }}
                />
                {c.name}
              </button>
            ))}
          </div>
          <p className="mt-6 text-xs leading-5 text-muted-foreground">
            Clique ou selecione um horário para criar. Arraste um compromisso para reagendar; ajuste
            a borda para mudar a duração.
          </p>
        </aside>
        <section aria-label="Agenda" className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b p-3">
            <Button variant="outline" size="sm" onClick={() => calendar.current?.getApi().today()}>
              Hoje
            </Button>
            <div className="flex">
              <Button
                aria-label="Período anterior"
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => calendar.current?.getApi().prev()}
              >
                <ChevronLeft />
              </Button>
              <Button
                aria-label="Próximo período"
                size="icon"
                variant="ghost"
                className="size-8"
                onClick={() => calendar.current?.getApi().next()}
              >
                <ChevronRight />
              </Button>
            </div>
            <h2 className="min-w-32 flex-1 text-sm font-semibold">{title}</h2>
            <label className="sr-only" htmlFor="calendar-view">
              Visualização
            </label>
            <select
              id="calendar-view"
              className="h-9 rounded-md border bg-card px-2 text-xs"
              value={view}
              onChange={(e) => {
                setView(e.target.value);
                calendar.current?.getApi().changeView(e.target.value);
              }}
            >
              {[
                ['timeGridDay', 'Dia'],
                ['timeGridWeek', 'Semana'],
                ['workWeek', 'Semana de trabalho'],
                ['dayGridMonth', 'Mês'],
                ['listMonth', 'Agenda'],
              ].map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            {!desktop && (
              <label className="flex items-center gap-2 text-xs">
                <CalendarDays className="size-4" />
                <Input
                  type="date"
                  aria-label="Ir para data"
                  className="h-9 w-36"
                  onChange={(e) => {
                    if (e.target.value) calendar.current?.getApi().gotoDate(e.target.value);
                  }}
                />
              </label>
            )}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
            <div className="relative min-w-32 flex-1">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input
                aria-label="Pesquisar eventos"
                placeholder="Pesquisar título, descrição ou local"
                className="h-9 pl-8"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select
              aria-label="Tipo de compromisso"
              className="h-9 rounded-md border bg-card px-2 text-xs"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              <option value="all">Todos os tipos</option>
              <option value="meeting">Reuniões</option>
              <option value="appointment">Compromissos</option>
            </select>
            <select
              aria-label="Filtrar calendário"
              className="h-9 max-w-40 rounded-md border bg-card px-2 text-xs lg:hidden"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="">Todos os calendários</option>
              {calendars.data?.map((c) => (
                <option value={c.id} key={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            {!desktop && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Criar calendário"
                onClick={() => setNewCalendar(true)}
              >
                <Plus />
              </Button>
            )}
          </div>
          {(events.error || calendars.error) && (
            <ErrorState
              onRetry={() => {
                void events.refetch();
                void calendars.refetch();
              }}
            />
          )}
          <div
            className="apmail-calendar min-h-0 flex-1 overflow-auto p-2"
            aria-busy={events.isFetching || loading}
          >
            <FullCalendar
              ref={calendar}
              plugins={calendarPlugins}
              locale={ptBr}
              timeZone={timezone}
              initialView={view}
              views={calendarViews}
              headerToolbar={false}
              height="100%"
              nowIndicator
              selectable
              editable
              selectMirror
              dayMaxEvents
              allDayText="Dia inteiro"
              slotMinTime="00:00:00"
              slotMaxTime="24:00:00"
              scrollTime="08:00:00"
              eventMinHeight={24}
              eventShortHeight={32}
              longPressDelay={400}
              events={visibleEvents}
              eventDisplay="block"
              slotEventOverlap={false}
              datesSet={datesChanged}
              dateClick={(info) =>
                create(
                  info.date.toISOString(),
                  new Date(+info.date + (info.allDay ? 86400000 : 3600000)).toISOString(),
                  info.allDay,
                )
              }
              select={(info) => {
                create(info.start.toISOString(), info.end.toISOString(), info.allDay);
                calendar.current?.getApi().unselect();
              }}
              eventClick={(info) => {
                setLoading(true);
                void api<CalendarEvent>(
                  '/calendar/events/' + String(info.event.extendedProps.event_id),
                )
                  .then((event) =>
                    setEditing({
                      event,
                      start: info.event.start!.toISOString(),
                      end: info.event.end!.toISOString(),
                      allDay: info.event.allDay,
                      original: String(info.event.extendedProps.original),
                    }),
                  )
                  .catch((e) => toast.error(e.message))
                  .finally(() => setLoading(false));
              }}
              eventDrop={(info) => void move(info)}
              eventResize={(info) => void move(info)}
              eventDidMount={(info) => {
                info.el.dataset.eventId = String(info.event.extendedProps.event_id);
                info.el.title =
                  info.event.title +
                  (info.event.extendedProps.location
                    ? ' · ' + info.event.extendedProps.location
                    : '');
              }}
            />
          </div>
          <div role="status" className="shrink-0 border-t px-3 py-1 text-xs text-muted-foreground">
            {events.isFetching
              ? 'Atualizando agenda…'
              : `${events.data?.length ?? 0} compromisso(s) neste período`}
          </div>
        </section>
      </div>
      {editing && calendars.data && (
        <EventEditor
          calendars={calendars.data}
          {...editing}
          timezone={timezone}
          onClose={() => setEditing(null)}
        />
      )}
      <Dialog open={newCalendar} onOpenChange={setNewCalendar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Novo calendário</DialogTitle>
            <DialogDescription>Separe compromissos pessoais e de trabalho.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              setSaving(true);
              setCalendarError('');
              void api('/calendars', { method: 'POST', body: { name, color, timezone } })
                .then(() => {
                  void client.invalidateQueries({ queryKey: ['calendar'] });
                  setNewCalendar(false);
                  setName('');
                })
                .catch((e) => setCalendarError(e.message))
                .finally(() => setSaving(false));
            }}
          >
            <label className="block space-y-1 text-sm">
              Nome
              <Input
                required
                maxLength={100}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="block space-y-1 text-sm">
              Cor
              <Input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </label>
            {calendarError && (
              <p role="alert" className="text-sm text-destructive">
                {calendarError}
              </p>
            )}
            <Button disabled={saving}>{saving ? 'Salvando…' : 'Criar calendário'}</Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
