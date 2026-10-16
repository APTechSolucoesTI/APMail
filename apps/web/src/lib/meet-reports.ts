import type { MeetConfig, MeetReportRow } from '@apmail/shared';
export const meetStatusLabels: Record<MeetReportRow['status'], string> = {
  completed: 'Concluída',
  ongoing: 'Em andamento',
  scheduled: 'Agendada',
  unverified: 'Sem registro de realização',
  cancelled: 'Cancelada',
};
export const meetDuration = (seconds: number | null) =>
  seconds === null
    ? 'Não disponível'
    : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}min`;
export const meetDate = (value: string | null | undefined, timezone = 'America/Sao_Paulo') =>
  value
    ? new Intl.DateTimeFormat('pt-BR', {
        timeZone: timezone,
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(new Date(value))
    : 'Não disponível';
export type MeetSpace = {
  id: string;
  meeting_url: string;
  resource_name: string;
  app_created: boolean;
  config: MeetConfig;
  last_sync_at: string | null;
  sync_status: string;
  sync_error: string | null;
};
export type MeetArtifact = {
  id: string;
  resource_name: string;
  kind: 'recording' | 'transcript' | 'smart_notes';
  state: string;
  starts_at: string | null;
  ends_at: string | null;
  external_url: string | null;
  document_id: string | null;
  entries_status: string;
  entries_error: string | null;
  body_text: string | null;
};
export type MeetDetail = {
  id: string;
  record: null | {
    id: string;
    title: string;
    event_id: string | null;
    space_id: string;
    resource_name: string;
    space_resource: string;
    account_email: string;
    meeting_url: string;
    starts_at: string;
    ends_at: string | null;
    last_sync_at: string | null;
    sync_status: string;
    sync_error: string | null;
    artifact_status: Record<string, { state?: string; message?: string }>;
  };
  event: null | {
    id: string;
    title: string;
    organizer: string | null;
    starts_at: string;
    ends_at: string;
    timezone: string;
    meeting_url: string | null;
    status: string;
  };
  attendees: { address: string; name?: string; status?: string }[];
  contacts: Record<string, { id: string; name: string }>;
  participants: {
    id: string;
    display_name: string;
    kind: string;
    google_user: string | null;
    first_join_at: string | null;
    last_leave_at: string | null;
    duration_seconds: number | null;
    sessions: { id: string; starts_at: string; ends_at: string | null }[];
  }[];
  artifacts: MeetArtifact[];
  timeline: { at: string; label: string; source: string }[];
  limitations: string[];
};
export type TranscriptPage = {
  items: {
    id: string;
    body_text: string;
    starts_at: string;
    ends_at: string;
    display_name: string | null;
    external_url: string | null;
  }[];
  hasMore?: boolean;
  page: number;
};
