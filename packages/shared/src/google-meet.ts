import { z } from 'zod';
import { timezoneSchema } from './schemas/auth.js';

export const GOOGLE_MEET_SCOPE = 'https://www.googleapis.com/auth/meetings.space.created';
export const GOOGLE_MEET_READ_SCOPE = 'https://www.googleapis.com/auth/meetings.space.readonly';
export const GOOGLE_CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
export const GOOGLE_DRIVE_MEET_SCOPE = 'https://www.googleapis.com/auth/drive.meet.readonly';
export const googleTokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().optional(),
  expires_in: z.number().positive().default(3600),
  scope: z.string().default(''),
  token_type: z.string().optional(),
});
export const googleProfileSchema = z.object({
  sub: z.string(),
  email: z.email(),
  email_verified: z.boolean(),
});
export const meetConfigSchema = z.object({
  accessType: z.enum(['OPEN', 'TRUSTED', 'RESTRICTED']).optional(),
  moderation: z.enum(['ON', 'OFF']).optional(),
  attendanceReportGenerationType: z.enum(['GENERATE_REPORT', 'DO_NOT_GENERATE']).optional(),
  artifactConfig: z
    .object({
      recordingConfig: z.object({ autoRecordingGeneration: z.enum(['ON', 'OFF']) }).optional(),
      transcriptionConfig: z
        .object({ autoTranscriptionGeneration: z.enum(['ON', 'OFF']) })
        .optional(),
      smartNotesConfig: z.object({ autoSmartNotesGeneration: z.enum(['ON', 'OFF']) }).optional(),
    })
    .optional(),
});
export type MeetConfig = z.infer<typeof meetConfigSchema>;
/** Ignore provider defaults/unknown future fields; write requests stay strict. */
export function editableMeetConfig(value: unknown): MeetConfig {
  const object = (raw: unknown): Record<string, unknown> =>
    raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const raw = object(value),
    result: Record<string, unknown> = {};
  for (const key of ['accessType', 'moderation', 'attendanceReportGenerationType'] as const) {
    const parsed = meetConfigSchema.shape[key].safeParse(raw[key]);
    if (parsed.success && parsed.data !== undefined) result[key] = parsed.data;
  }
  const artifacts: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(
    meetConfigSchema.shape.artifactConfig.unwrap().shape,
  )) {
    const parsed = schema.safeParse(object(raw.artifactConfig)[key]);
    if (parsed.success && parsed.data !== undefined) artifacts[key] = parsed.data;
  }
  if (Object.keys(artifacts).length) result.artifactConfig = artifacts;
  return meetConfigSchema.parse(result);
}
export const googleSpaceSchema = z.object({
  name: z.string().regex(/^spaces\/[a-zA-Z0-9_-]+$/),
  meetingUri: z.url(),
  meetingCode: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
  activeConference: z.object({ conferenceRecord: z.string() }).optional(),
});
export const meetPreferencesSchema = z
  .object({
    declared_plan: z
      .enum([
        'unknown',
        'free',
        'one_premium',
        'ai_pro',
        'ai_ultra',
        'workspace_starter',
        'workspace_standard',
        'workspace_plus',
        'workspace_enterprise',
        'workspace_education',
        'other',
      ])
      .default('unknown'),
    mailbox_id: z.uuid().nullable().default(null),
    default_access: z.enum(['TRUSTED', 'RESTRICTED', 'OPEN']).default('TRUSTED'),
    auto_recording: z.boolean().default(false),
    auto_transcription: z.boolean().default(false),
    auto_notes: z.boolean().default(false),
    sync_enabled: z.boolean().default(false),
    artifacts_consent: z.boolean().default(false),
    retention_days: z.number().int().min(30).max(3650).default(90),
  })
  .refine((v) => !v.sync_enabled || v.artifacts_consent, {
    path: ['artifacts_consent'],
    message: 'Autorize a importação dos dados de reunião para ativar a sincronização.',
  });
export type MeetPreferences = z.infer<typeof meetPreferencesSchema>;
export const meetPlanLabels: Record<MeetPreferences['declared_plan'], string> = {
  unknown: 'Não informado',
  free: 'Google Meet gratuito',
  one_premium: 'Google One Premium (2 TB ou mais)',
  ai_pro: 'Google AI Pro',
  ai_ultra: 'Google AI Ultra',
  workspace_starter: 'Workspace Business Starter',
  workspace_standard: 'Workspace Business Standard',
  workspace_plus: 'Workspace Business Plus',
  workspace_enterprise: 'Workspace Enterprise',
  workspace_education: 'Workspace Education',
  other: 'Outro plano',
};
export function defaultMeetConfig(
  preferences: Pick<
    MeetPreferences,
    'default_access' | 'auto_recording' | 'auto_transcription' | 'auto_notes'
  >,
): MeetConfig {
  return {
    accessType: preferences.default_access,
    ...(preferences.auto_recording || preferences.auto_transcription || preferences.auto_notes
      ? {
          artifactConfig: {
            ...(preferences.auto_recording
              ? { recordingConfig: { autoRecordingGeneration: 'ON' as const } }
              : {}),
            ...(preferences.auto_transcription
              ? { transcriptionConfig: { autoTranscriptionGeneration: 'ON' as const } }
              : {}),
            ...(preferences.auto_notes
              ? { smartNotesConfig: { autoSmartNotesGeneration: 'ON' as const } }
              : {}),
          },
        }
      : {}),
  };
}
export const meetResourceSchema = z
  .string()
  .max(1024)
  .regex(
    /^(?:spaces\/[\w-]+(?:\/members\/[\w-]+)?|conferenceRecords\/[\w-]+(?:\/(?:participants|recordings|transcripts|smartNotes)\/[\w-]+)?(?:\/(?:participantSessions|entries)\/[\w-]+)?)$/,
  );
const instant = z.iso.datetime({ offset: true });
export const conferenceSchema = z.object({
  name: meetResourceSchema,
  space: meetResourceSchema,
  startTime: instant,
  endTime: instant.optional(),
  expireTime: instant.optional(),
});
export const meetParticipantSchema = z.object({
  name: meetResourceSchema,
  signedinUser: z
    .object({ user: z.string().max(300), displayName: z.string().max(300).optional() })
    .optional(),
  anonymousUser: z.object({ displayName: z.string().max(300).optional() }).optional(),
  phoneUser: z.object({ displayName: z.string().max(300).optional() }).optional(),
  earliestStartTime: instant.optional(),
  latestEndTime: instant.optional(),
});
export const meetSessionSchema = z.object({
  name: meetResourceSchema,
  startTime: instant,
  endTime: instant.optional(),
});
export const meetArtifactSchema = z.object({
  name: meetResourceSchema,
  state: z.string().max(100).default('STATE_UNSPECIFIED'),
  startTime: instant.optional(),
  endTime: instant.optional(),
  driveDestination: z
    .object({ file: z.string().max(500).optional(), exportUri: z.url().optional() })
    .optional(),
  docsDestination: z
    .object({ document: z.string().max(500).optional(), exportUri: z.url().optional() })
    .optional(),
});
export const meetEntrySchema = z.object({
  name: meetResourceSchema,
  participant: meetResourceSchema,
  text: z.string().max(200000),
  startTime: instant,
  endTime: instant,
  languageCode: z.string().max(50).optional(),
});
export const meetMemberSchema = z.object({
  name: meetResourceSchema,
  email: z.email().optional(),
  role: z.enum(['ROLE_UNSPECIFIED', 'COHOST', 'CONTRIBUTOR', 'VIEWER']).optional(),
});

/** Union, rather than sum, prevents double counting simultaneous devices/reconnections. */
export function participationSeconds(
  sessions: { start: string | Date; end: string | Date | null }[],
  limit?: string | Date | null,
): number {
  const intervals = sessions
    .flatMap((s) => {
      const start = +new Date(s.start),
        end = +(s.end ? new Date(s.end) : limit ? new Date(limit) : new Date(NaN));
      return Number.isFinite(start) && Number.isFinite(end) && end > start
        ? [[start, end] as const]
        : [];
    })
    .sort((a, b) => a[0] - b[0]);
  let total = 0,
    start = 0,
    end = 0;
  for (const interval of intervals) {
    if (interval[0] > end) {
      total += Math.max(0, end - start);
      [start, end] = interval;
    } else end = Math.max(end, interval[1]);
  }
  return Math.floor((total + Math.max(0, end - start)) / 1000);
}
export const meetJobSchema = z
  .object({
    kind: z.enum([
      'space',
      'conference',
      'participants',
      'sessions',
      'recordings',
      'transcripts',
      'smartNotes',
      'entries',
      'notes',
    ]),
    connection_id: z.uuid(),
    space_id: z.uuid(),
    record_id: z.uuid().optional(),
    participant_id: z.uuid().optional(),
    artifact_id: z.uuid().optional(),
    resource: meetResourceSchema,
    page_token: z.string().max(8192).optional(),
    generation: z.uuid(),
  })
  .superRefine((job, context) => {
    if (job.kind !== 'space' && !job.record_id)
      context.addIssue({
        code: 'custom',
        path: ['record_id'],
        message: 'Conferência obrigatória nesta etapa.',
      });
    if (job.kind === 'sessions' && !job.participant_id)
      context.addIssue({
        code: 'custom',
        path: ['participant_id'],
        message: 'Participante obrigatório.',
      });
    if (['entries', 'notes'].includes(job.kind) && !job.artifact_id)
      context.addIssue({ code: 'custom', path: ['artifact_id'], message: 'Arquivo obrigatório.' });
  });
export type MeetJob = z.infer<typeof meetJobSchema>;
export const meetReportQuerySchema = z
  .object({
    timezone: timezoneSchema.default('America/Sao_Paulo'),
    from: z.iso
      .date()
      .default(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)),
    to: z.iso.date().default(() => new Date().toISOString().slice(0, 10)),
    search: z.string().trim().max(200).default(''),
    status: z
      .enum(['all', 'scheduled', 'ongoing', 'completed', 'unverified', 'cancelled'])
      .default('all'),
    artifact: z.enum(['all', 'recording', 'transcript', 'smart_notes']).default('all'),
    account: z.string().max(254).default(''),
    organizer: z.string().max(254).default(''),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce
      .number()
      .pipe(z.union([z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100)]))
      .default(10),
    sort: z
      .enum(['date_desc', 'date_asc', 'title_asc', 'title_desc', 'duration_asc', 'duration_desc'])
      .default('date_desc'),
  })
  .refine((q) => q.from <= q.to && +new Date(q.to) - +new Date(q.from) <= 366 * 86400000, {
    message: 'Selecione um período válido de até um ano.',
  });
export type MeetReportQuery = z.infer<typeof meetReportQuerySchema>;
export const meetCapabilitySchema = z.object({
  state: z.enum([
    'available',
    'unavailable',
    'permission_required',
    'configuration_pending',
    'unverified',
  ]),
  message: z.string(),
  source: z.enum(['api', 'scope', 'configuration']),
});
export const meetCapabilitiesSchema = z.record(z.string(), meetCapabilitySchema);
export type MeetCapability = z.infer<typeof meetCapabilitySchema>;
export const meetCapabilityLabels: Record<string, string> = {
  account: 'Conexão da conta',
  create: 'Criação de salas',
  records: 'Registros de conferência',
  participants: 'Participantes e sessões',
  recordings: 'Consulta de gravações',
  transcripts: 'Transcrições estruturadas',
  smartNotes: 'Notas inteligentes',
  members: 'Membros e coorganizadores',
  automatic: 'Geração automática de arquivos',
  calendar: 'Google Agenda',
};
export type MeetReportRow = {
  id: string;
  title: string;
  organizer: string | null;
  event_id: string | null;
  space_id: string | null;
  scheduled_start: string | null;
  scheduled_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
  date: string;
  duration_seconds: number | null;
  participant_count: number | null;
  recordings: number | null;
  transcripts: number | null;
  smart_notes: number | null;
  status: 'scheduled' | 'completed' | 'ongoing' | 'unverified' | 'cancelled';
  account_email: string | null;
  meeting_url: string;
  last_sync: string | null;
};
export type MeetReportResult = {
  items: MeetReportRow[];
  total: number;
  page: number;
  pageSize: number;
  coverage: {
    records: number;
    participants: number;
    recordings: number;
    transcripts: number;
    smart_notes: number;
  };
  summary: {
    completed: number;
    ongoing: number;
    scheduled: number;
    unverified: number;
    total_seconds: number;
    average_seconds: number | null;
    participations: number;
    recordings: number;
    transcripts: number;
    smart_notes: number;
  };
  chart: { date: string; completed: number; scheduled: number }[];
  accounts: string[];
  organizers: string[];
};
export type MeetIntegrationStatus = {
  configured: boolean;
  redirect_uri: string;
  connected: boolean;
  email: string | null;
  meet: boolean;
  calendar: boolean;
  scopes: string[];
  preferences: MeetPreferences;
  capabilities: Record<string, MeetCapability>;
  last_check: string | null;
  last_sync: { at: string | null; status: string; message: string | null } | null;
};
