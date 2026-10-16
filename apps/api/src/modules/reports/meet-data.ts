import { sql } from 'kysely';
import {
  calendarInstant,
  calendarOccurrences,
  participationSeconds,
  type MeetReportQuery,
  type MeetReportResult,
  type MeetReportRow,
} from '@apmail/shared';
import { eventInput } from '@apmail/db';
import type { Resources } from '../resources.js';
import type { RequestContext } from '../../authz/context.js';
import { requireTenant, conflict, notFound } from '../../authz/context.js';
import { resolveContacts } from '../contact-resolution.js';

const readableState = (raw: unknown, key: string) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const value: unknown = (raw as Record<string, unknown>)[key];
  return !!value && typeof value === 'object' && 'state' in value && value.state === 'available';
};
const normalized = (value: string) =>
  value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('pt-BR');
export async function meetReportData(
  r: Resources,
  ctx: RequestContext | null,
  query: MeetReportQuery,
): Promise<MeetReportResult & { all: MeetReportRow[] }> {
  const c = requireTenant(ctx),
    from = new Date(calendarInstant(query.from + 'T00:00', query.timezone));
  const nextDate = new Date(+new Date(query.to + 'T00:00Z') + 86400000).toISOString().slice(0, 10);
  const until = new Date(calendarInstant(nextDate + 'T00:00', query.timezone));
  const [actual, events, spaces] = await Promise.all([
    r.db
      .selectFrom('google_meet_records as rec')
      .innerJoin('google_meet_spaces as s', 's.id', 'rec.space_id')
      .innerJoin('google_connections as g', 'g.id', 'rec.connection_id')
      .innerJoin('google_meet_preferences as prefs', (join) =>
        join.onRef('prefs.tenant_id', '=', 's.tenant_id').onRef('prefs.user_id', '=', 's.user_id'),
      )
      .leftJoin('calendar_events as e', 'e.id', 'rec.event_id')
      .selectAll('rec')
      .select([
        's.meeting_url',
        's.app_created',
        'g.email',
        'e.organizer',
        'e.starts_at as scheduled_start',
        'e.ends_at as scheduled_end',
      ])
      .select((eb) => [
        eb
          .selectFrom('google_meet_participants as p')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('p.record_id', '=', 'rec.id')
          .as('participants'),
        eb
          .selectFrom('google_meet_artifacts as a')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('a.record_id', '=', 'rec.id')
          .where('a.kind', '=', 'recording')
          .as('recordings'),
        eb
          .selectFrom('google_meet_artifacts as a')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('a.record_id', '=', 'rec.id')
          .where('a.kind', '=', 'transcript')
          .as('transcripts'),
        eb
          .selectFrom('google_meet_artifacts as a')
          .select(eb.fn.countAll<number>().as('n'))
          .whereRef('a.record_id', '=', 'rec.id')
          .where('a.kind', '=', 'smart_notes')
          .as('notes'),
      ])
      .where('s.tenant_id', '=', c.tenantId)
      .where('s.user_id', '=', c.userId)
      .where('prefs.artifacts_consent', '=', true)
      .where('rec.starts_at', '>=', from)
      .where('rec.starts_at', '<', until)
      .limit(5001)
      .execute(),
    r.db
      .selectFrom('calendar_events')
      .selectAll()
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('meeting_url', 'like', 'https://meet.google.com/%')
      .where('starts_at', '<', until)
      .where((eb) => eb.or([eb('ends_at', '>=', from), eb('rrule', 'is not', null)]))
      .limit(1001)
      .execute(),
    r.db
      .selectFrom('google_meet_spaces as s')
      .innerJoin('google_connections as g', 'g.id', 's.connection_id')
      .select(['s.id', 's.meeting_url', 'g.email'])
      .where('s.tenant_id', '=', c.tenantId)
      .where('s.user_id', '=', c.userId)
      .execute(),
  ]);
  if (actual.length > 5000 || events.length > 1000)
    throw conflict(
      'Há muitos registros neste período. Selecione um intervalo menor para consultar ou exportar.',
    );
  const rows: MeetReportRow[] = actual.map((record) => ({
    id: record.id,
    title: record.title,
    organizer: record.organizer ?? (record.app_created ? record.email : null),
    event_id: record.event_id,
    space_id: record.space_id,
    scheduled_start: record.scheduled_start?.toISOString() ?? null,
    scheduled_end: record.scheduled_end?.toISOString() ?? null,
    actual_start: record.starts_at.toISOString(),
    actual_end: record.ends_at?.toISOString() ?? null,
    date: record.starts_at.toISOString(),
    duration_seconds: record.ends_at
      ? Math.max(0, Math.floor((+record.ends_at - +record.starts_at) / 1000))
      : null,
    participant_count: readableState(record.artifact_status, 'participants')
      ? Number(record.participants)
      : null,
    recordings: readableState(record.artifact_status, 'recordings')
      ? Number(record.recordings)
      : null,
    transcripts: readableState(record.artifact_status, 'transcripts')
      ? Number(record.transcripts)
      : null,
    smart_notes: readableState(record.artifact_status, 'smartNotes') ? Number(record.notes) : null,
    status: record.ends_at ? 'completed' : 'ongoing',
    account_email: record.email,
    meeting_url: record.meeting_url,
    last_sync: record.last_sync_at?.toISOString() ?? null,
  }));
  for (const event of events) {
    const occurrences = calendarOccurrences(eventInput(event), from, until);
    // A recurring calendar event can own multiple conferences; match each to its nearest occurrence.
    const realized = new Set<string>();
    for (const conference of actual.filter((record) => record.event_id === event.id)) {
      const candidate = occurrences
        .filter((o) => Math.abs(+new Date(o.start) - +conference.starts_at) <= 12 * 3600000)
        .sort(
          (a, b) =>
            Math.abs(+new Date(a.start) - +conference.starts_at) -
            Math.abs(+new Date(b.start) - +conference.starts_at),
        )[0];
      if (candidate) {
        realized.add(candidate.original);
        const row = rows.find((item) => item.id === conference.id);
        if (row) {
          row.scheduled_start = candidate.start;
          row.scheduled_end = candidate.end;
        }
      }
    }
    const space = spaces.find((s) => s.meeting_url === event.meeting_url);
    for (const occurrence of occurrences) {
      if (realized.has(occurrence.original)) continue;
      rows.push({
        id: 'event_' + event.id + '_' + encodeURIComponent(occurrence.original),
        title: occurrence.title ?? event.title,
        organizer: event.organizer,
        event_id: event.id,
        space_id: space?.id ?? null,
        scheduled_start: occurrence.start,
        scheduled_end: occurrence.end,
        actual_start: null,
        actual_end: null,
        date: occurrence.start,
        duration_seconds: null,
        participant_count: null,
        recordings: null,
        transcripts: null,
        smart_notes: null,
        status:
          event.status === 'cancelled'
            ? 'cancelled'
            : +new Date(occurrence.start) > Date.now()
              ? 'scheduled'
              : 'unverified',
        account_email: space?.email ?? null,
        meeting_url: event.meeting_url!,
        last_sync: null,
      });
      if (rows.length > 10000)
        throw conflict('Reduza o período para consultar esta quantidade de ocorrências.');
    }
  }
  const accounts = [
      ...new Set(rows.flatMap((row) => (row.account_email ? [row.account_email] : []))),
    ].sort(),
    organizers = [...new Set(rows.flatMap((row) => (row.organizer ? [row.organizer] : [])))].sort();
  const search = normalized(query.search);
  const filtered = rows.filter(
    (row) =>
      (!search ||
        normalized(
          row.title +
            ' ' +
            (row.organizer ?? '') +
            ' ' +
            row.meeting_url +
            ' ' +
            (row.account_email ?? ''),
        ).includes(search)) &&
      (query.status === 'all' || row.status === query.status) &&
      (!query.account || row.account_email === query.account) &&
      (!query.organizer || row.organizer === query.organizer) &&
      (query.artifact === 'all' ||
        ((query.artifact === 'recording'
          ? row.recordings
          : query.artifact === 'transcript'
            ? row.transcripts
            : row.smart_notes) !== null &&
          (query.artifact === 'recording'
            ? row.recordings!
            : query.artifact === 'transcript'
              ? row.transcripts!
              : row.smart_notes!) > 0)),
  );
  filtered.sort(
    (a, b) =>
      (query.sort.startsWith('title_')
        ? a.title.localeCompare(b.title, 'pt-BR', { numeric: true, sensitivity: 'base' }) *
          (query.sort === 'title_desc' ? -1 : 1)
        : query.sort.startsWith('duration_')
          ? a.duration_seconds === null
            ? b.duration_seconds === null
              ? 0
              : 1
            : b.duration_seconds === null
              ? -1
              : (a.duration_seconds - b.duration_seconds) *
                (query.sort === 'duration_desc' ? -1 : 1)
          : query.sort === 'date_asc'
            ? a.date.localeCompare(b.date)
            : b.date.localeCompare(a.date)) || a.id.localeCompare(b.id),
  );
  const completed = filtered.filter((row) => row.status === 'completed'),
    seconds = completed.reduce((total, row) => total + (row.duration_seconds ?? 0), 0);
  const chart = new Map<string, { date: string; completed: number; scheduled: number }>();
  for (const row of filtered) {
    const date = new Intl.DateTimeFormat('en-CA', {
      timeZone: query.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(row.date));
    const entry = chart.get(date) ?? { date, completed: 0, scheduled: 0 };
    if (row.status === 'completed') entry.completed++;
    if (row.status === 'scheduled') entry.scheduled++;
    chart.set(date, entry);
  }
  return {
    items: filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize),
    all: filtered,
    total: filtered.length,
    page: query.page,
    pageSize: query.pageSize,
    accounts,
    organizers,
    coverage: {
      records: filtered.filter((row) => row.actual_start).length,
      participants: filtered.filter((row) => row.participant_count !== null).length,
      recordings: filtered.filter((row) => row.recordings !== null).length,
      transcripts: filtered.filter((row) => row.transcripts !== null).length,
      smart_notes: filtered.filter((row) => row.smart_notes !== null).length,
    },
    summary: {
      completed: completed.length,
      ongoing: filtered.filter((row) => row.status === 'ongoing').length,
      scheduled: filtered.filter((row) => row.status === 'scheduled').length,
      unverified: filtered.filter((row) => row.status === 'unverified').length,
      total_seconds: seconds,
      average_seconds: completed.length ? Math.round(seconds / completed.length) : null,
      participations: filtered.reduce((n, row) => n + (row.participant_count ?? 0), 0),
      recordings: filtered.filter((row) => (row.recordings ?? 0) > 0).length,
      transcripts: filtered.filter((row) => (row.transcripts ?? 0) > 0).length,
      smart_notes: filtered.filter((row) => (row.smart_notes ?? 0) > 0).length,
    },
    chart: [...chart.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

export async function meetDetail(r: Resources, ctx: RequestContext | null, id: string) {
  const c = requireTenant(ctx);
  const plannedId = id.match(/^event_([\da-f-]{36})_(.+)$/i);
  const record = plannedId
    ? null
    : await r.db
        .selectFrom('google_meet_records as rec')
        .innerJoin('google_meet_spaces as s', 's.id', 'rec.space_id')
        .innerJoin('google_connections as g', 'g.id', 'rec.connection_id')
        .innerJoin('google_meet_preferences as prefs', (join) =>
          join
            .onRef('prefs.tenant_id', '=', 's.tenant_id')
            .onRef('prefs.user_id', '=', 's.user_id'),
        )
        .selectAll('rec')
        .select([
          's.meeting_url',
          's.app_created',
          's.sync_status',
          's.sync_error',
          's.resource_name as space_resource',
          'g.email as account_email',
          'g.scopes',
        ])
        .where('rec.id', '=', id)
        .where('s.tenant_id', '=', c.tenantId)
        .where('s.user_id', '=', c.userId)
        .where('prefs.artifacts_consent', '=', true)
        .executeTakeFirst();
  if (!plannedId && !record) throw notFound();
  const eventId = plannedId?.[1] ?? record?.event_id;
  let event = eventId
    ? await r.db
        .selectFrom('calendar_events')
        .selectAll()
        .where('id', '=', eventId)
        .where('tenant_id', '=', c.tenantId)
        .where('user_id', '=', c.userId)
        .executeTakeFirst()
    : null;
  if (plannedId && (!event || !event.meeting_url?.startsWith('https://meet.google.com/')))
    throw notFound();
  if (plannedId && event) {
    let original: string;
    try {
      original = decodeURIComponent(plannedId[2]!);
    } catch {
      throw notFound();
    }
    const start = new Date(original);
    if (!Number.isFinite(+start)) throw notFound();
    const occurrence = calendarOccurrences(
      eventInput(event),
      new Date(+start - 86400000),
      new Date(+start + 86400000),
    ).find((item) => item.original === original);
    if (!occurrence) throw notFound();
    event = {
      ...event,
      title: occurrence.title ?? event.title,
      starts_at: new Date(occurrence.start),
      ends_at: new Date(occurrence.end),
    };
  }
  const [participants, sessions, artifacts] = record
    ? await Promise.all([
        r.db
          .selectFrom('google_meet_participants')
          .selectAll()
          .where('record_id', '=', record.id)
          .orderBy('first_join_at')
          .execute(),
        r.db
          .selectFrom('google_meet_sessions as s')
          .innerJoin('google_meet_participants as p', 'p.id', 's.participant_id')
          .selectAll('s')
          .where('p.record_id', '=', record.id)
          .orderBy('s.starts_at')
          .execute(),
        r.db
          .selectFrom('google_meet_artifacts')
          .selectAll()
          .where('record_id', '=', record.id)
          .orderBy('starts_at')
          .execute(),
      ])
    : [[], [], []];
  const attendees = event ? eventInput(event).attendees : [];
  const contacts = await resolveContacts(
    r.db,
    c,
    attendees.map((a) => a.address),
  );
  const timeline: { at: string; label: string; source: string }[] = [];
  if (record) {
    timeline.push({
      at: record.starts_at.toISOString(),
      label: 'Conferência iniciada',
      source: 'Google Meet',
    });
    if (record.ends_at)
      timeline.push({
        at: record.ends_at.toISOString(),
        label: 'Conferência encerrada',
        source: 'Google Meet',
      });
    for (const session of sessions) {
      const name =
        participants.find((p) => p.id === session.participant_id)?.display_name ||
        'Participante sem nome';
      timeline.push({
        at: session.starts_at.toISOString(),
        label: name + ' entrou',
        source: 'Sessão Google Meet',
      });
      if (session.ends_at)
        timeline.push({
          at: session.ends_at.toISOString(),
          label: name + ' saiu',
          source: 'Sessão Google Meet',
        });
    }
  }
  timeline.sort((a, b) => a.at.localeCompare(b.at));
  return {
    id,
    record,
    event,
    attendees,
    contacts,
    artifacts,
    timeline,
    participants: participants.map((p) => ({
      ...p,
      sessions: sessions.filter((s) => s.participant_id === p.id),
      duration_seconds:
        p.sessions_synced_at &&
        (record?.ends_at || !sessions.some((s) => s.participant_id === p.id && !s.ends_at))
          ? participationSeconds(
              sessions
                .filter((s) => s.participant_id === p.id)
                .map((s) => ({ start: s.starts_at, end: s.ends_at })),
              record?.ends_at,
            )
          : null,
    })),
    limitations: [
      'O Google normalmente fornece o identificador e o nome do participante, sem seu e-mail. Nomes não são usados para vincular contatos.',
      'Uma lista de arquivos vazia não confirma ausência de gravação ou transcrição no plano; os arquivos podem estar em processamento ou fora da permissão.',
      'Os registros de conferência e os trechos de transcrição ficam disponíveis na API por cerca de 30 dias. Dados já importados seguem a retenção configurada no APMail.',
    ],
  };
}
export async function transcriptRows(
  r: Resources,
  recordId: string,
  search = '',
  limit = 100001,
  offset = 0,
) {
  let query = r.db
    .selectFrom('google_meet_transcript_entries as entry')
    .innerJoin('google_meet_artifacts as a', 'a.id', 'entry.artifact_id')
    .leftJoin('google_meet_participants as p', (join) =>
      join
        .onRef('p.resource_name', '=', 'entry.participant_resource')
        .onRef('p.record_id', '=', 'a.record_id'),
    )
    .selectAll('entry')
    .select(['p.display_name', 'a.external_url', 'a.resource_name as transcript_resource'])
    .where('a.record_id', '=', recordId);
  if (search)
    query = query.where(
      sql<boolean>`entry.body_text ilike ${'%' + search.replace(/[\\%_]/g, '\\$&') + '%'}`,
    );
  return query.orderBy('entry.starts_at').orderBy('entry.id').limit(limit).offset(offset).execute();
}
