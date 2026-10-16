import type { CalendarEventInput } from '@apmail/shared';
export type UserCalendar = { id: string; name: string; color: string; timezone: string };
export type CalendarEvent = CalendarEventInput & {
  id: string;
  uid: string;
  organizer: string | null;
  sequence: number;
  external: boolean;
  status: string;
};
export type Occurrence = {
  id: string;
  event_id: string;
  original: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  color: string;
  calendar_name: string;
  editable: boolean;
  recurring: boolean;
  location: string;
};
export const reminderOptions = [
  { value: '', label: 'Sem lembrete' },
  { value: '0', label: 'No horário' },
  { value: '5', label: '5 minutos antes' },
  { value: '10', label: '10 minutos antes' },
  { value: '15', label: '15 minutos antes' },
  { value: '30', label: '30 minutos antes' },
  { value: '60', label: '1 hora antes' },
  { value: '1440', label: '1 dia antes' },
  { value: 'custom', label: 'Personalizado' },
];
