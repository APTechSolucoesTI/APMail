import { randomUUID } from 'node:crypto';
import { sql, type Kysely } from 'kysely';
import type { DB } from '../types.js';
import { asJson } from '../domain/threads.js';
import { GoogleClient, GoogleApiError, googleFailure } from './client.js';
import { googleAccessToken, type GoogleEnvironment } from './access.js';
import { getMeetPreferences, googleArtifactUrl } from './model.js';
import { eventInput } from '../domain/calendar.js';
import {
  GOOGLE_MEET_SCOPE,
  GOOGLE_MEET_READ_SCOPE,
  GOOGLE_DRIVE_MEET_SCOPE,
  calendarOccurrences,
  conferenceSchema,
  meetParticipantSchema,
  meetSessionSchema,
  meetArtifactSchema,
  meetEntrySchema,
  type MeetJob,
} from '@apmail/shared';

type Enqueue = (payload: MeetJob) => Promise<void>;
const pageQuery = (job: MeetJob) =>
  new URLSearchParams({
    pageSize: '100',
    ...(job.page_token ? { pageToken: job.page_token } : {}),
  });
export async function runMeetSyncPage(
  db: Kysely<DB>,
  env: GoogleEnvironment,
  job: MeetJob,
  enqueue: Enqueue,
  google = new GoogleClient(),
) {
  const space = await db
    .selectFrom('google_meet_spaces as s')
    .innerJoin('google_connections as c', 'c.id', 's.connection_id')
    .innerJoin('tenant_members as m', (join) =>
      join.onRef('m.user_id', '=', 's.user_id').onRef('m.tenant_id', '=', 's.tenant_id'),
    )
    .innerJoin('tenants as t', 't.id', 's.tenant_id')
    .selectAll('s')
    .select('c.scopes')
    .where('s.id', '=', job.space_id)
    .where('c.id', '=', job.connection_id)
    .where('m.status', '=', 'active')
    .where('t.deleted_at', 'is', null)
    .where('t.suspended_at', 'is', null)
    .executeTakeFirst();
  if (!space) return;
  const preferences = await getMeetPreferences(db, space.tenant_id, space.user_id);
  if (!preferences.artifacts_consent || !preferences.sync_enabled) return;
  const owner = { tenantId: space.tenant_id, userId: space.user_id };
  const record = job.record_id
    ? await db
        .selectFrom('google_meet_records')
        .selectAll()
        .where('id', '=', job.record_id)
        .where('space_id', '=', space.id)
        .where('connection_id', '=', job.connection_id)
        .executeTakeFirst()
    : null;
  if (
    job.kind !== 'space' &&
    (!record ||
      (job.resource !== record.resource_name &&
        !job.resource.startsWith(record.resource_name + '/')))
  )
    return;
  const status = async (key: string, value: object) => {
    if (record)
      await db
        .updateTable('google_meet_records')
        .set({
          artifact_status: sql`artifact_status || ${asJson({ [key]: value })}::jsonb`,
          last_sync_at: new Date(),
        })
        .where('id', '=', record.id)
        .execute();
  };
  const next = async (token: string | null) => {
    if (token) await enqueue({ ...job, page_token: token });
  };
  try {
    const access = await googleAccessToken(
      db,
      env,
      owner,
      [GOOGLE_MEET_SCOPE, GOOGLE_MEET_READ_SCOPE],
      google,
    );
    if (job.kind === 'space') {
      if (job.resource !== space.resource_name) return;
      if (!job.page_token) {
        const current = await google.space(access, space.resource_name);
        await db
          .updateTable('google_meet_spaces')
          .set({
            config: asJson(current.config ?? {}),
            sync_status: 'syncing',
            sync_error: null,
            sync_error_code: null,
          })
          .where('id', '=', space.id)
          .execute();
      }
      const query = pageQuery(job);
      query.set('filter', `space.name = "${space.resource_name}"`);
      const result = await google.page(
        access,
        'conferenceRecords',
        'conferenceRecords',
        conferenceSchema,
        query,
      );
      const events = await db
        .selectFrom('google_meet_event_links as l')
        .innerJoin('calendar_events as e', 'e.id', 'l.event_id')
        .selectAll('e')
        .where('l.space_id', '=', space.id)
        .where('e.tenant_id', '=', space.tenant_id)
        .where('e.user_id', '=', space.user_id)
        .execute();
      for (const conference of result.items) {
        if (
          conference.space !== space.resource_name ||
          !/^conferenceRecords\/[\w-]+$/.test(conference.name)
        )
          throw new Error('invalid_google_response');
        if (
          +new Date(conference.endTime ?? conference.startTime) <
          Date.now() - preferences.retention_days * 86400000
        )
          continue;
        const candidates = events.filter(
          (event) =>
            calendarOccurrences(
              eventInput(event),
              new Date(conference.startTime),
              new Date(+new Date(conference.endTime ?? conference.startTime) + 1),
            ).length > 0,
        );
        // A room can be reused. Only one temporally matching event establishes
        // an association; a shared link alone does not identify the appointment.
        const event = candidates.length === 1 ? candidates[0] : undefined;
        const row = await db
          .insertInto('google_meet_records')
          .values({
            tenant_id: space.tenant_id,
            connection_id: job.connection_id,
            space_id: space.id,
            resource_name: conference.name,
            starts_at: new Date(conference.startTime),
            ends_at: conference.endTime ? new Date(conference.endTime) : null,
            expires_at: conference.expireTime ? new Date(conference.expireTime) : null,
            event_id: event?.id ?? null,
            title: event?.title ?? 'Reunião Google Meet',
            last_sync_at: new Date(),
          })
          .onConflict((oc) =>
            oc.columns(['connection_id', 'resource_name']).doUpdateSet({
              ends_at: conference.endTime
                ? new Date(conference.endTime)
                : sql`google_meet_records.ends_at`,
              ...(event ? { event_id: event.id, title: event.title } : {}),
              expires_at: conference.expireTime ? new Date(conference.expireTime) : null,
              last_sync_at: new Date(),
            }),
          )
          .returning('id')
          .executeTakeFirstOrThrow();
        await enqueue({
          ...job,
          kind: 'conference',
          record_id: row.id,
          resource: conference.name,
          page_token: undefined,
        });
      }
      await next(result.next);
      await db
        .updateTable('google_meet_spaces')
        .set({
          last_sync_at: new Date(),
          sync_status: result.next ? 'syncing' : 'success',
          sync_error: null,
          sync_error_code: null,
        })
        .where('id', '=', space.id)
        .execute();
      return;
    }
    if (!record) return;
    if (job.kind === 'conference') {
      for (const kind of ['participants', 'recordings', 'transcripts', 'smartNotes'] as const)
        await enqueue({ ...job, kind, resource: record.resource_name, page_token: undefined });
      return;
    }
    if (job.kind === 'participants') {
      const result = await google.page(
        access,
        record.resource_name + '/participants',
        'participants',
        meetParticipantSchema,
        pageQuery(job),
      );
      for (const participant of result.items) {
        if (!participant.name.startsWith(record.resource_name + '/participants/'))
          throw new Error('invalid_google_response');
        const value = {
          display_name:
            participant.signedinUser?.displayName ??
            participant.anonymousUser?.displayName ??
            participant.phoneUser?.displayName ??
            '',
          google_user: participant.signedinUser?.user ?? null,
          kind: participant.signedinUser
            ? 'signed_in'
            : participant.phoneUser
              ? 'phone'
              : 'anonymous',
          first_join_at: participant.earliestStartTime
            ? new Date(participant.earliestStartTime)
            : null,
          last_leave_at: participant.latestEndTime ? new Date(participant.latestEndTime) : null,
        };
        const saved = await db
          .insertInto('google_meet_participants')
          .values({
            tenant_id: space.tenant_id,
            ...value,
            record_id: record.id,
            resource_name: participant.name,
          })
          .onConflict((oc) => oc.columns(['record_id', 'resource_name']).doUpdateSet(value))
          .returning('id')
          .executeTakeFirstOrThrow();
        await enqueue({
          ...job,
          kind: 'sessions',
          participant_id: saved.id,
          resource: participant.name,
          page_token: undefined,
        });
      }
      await next(result.next);
      await status('participants', { state: result.next ? 'processing' : 'available' });
      return;
    }
    if (job.kind === 'sessions') {
      const participant = await db
        .selectFrom('google_meet_participants')
        .select('id')
        .where('id', '=', job.participant_id ?? '')
        .where('record_id', '=', record.id)
        .where('resource_name', '=', job.resource)
        .executeTakeFirst();
      if (!participant) return;
      const result = await google.page(
        access,
        job.resource + '/participantSessions',
        'participantSessions',
        meetSessionSchema,
        pageQuery(job),
      );
      for (const session of result.items) {
        if (!session.name.startsWith(job.resource + '/participantSessions/'))
          throw new Error('invalid_google_response');
        await db
          .insertInto('google_meet_sessions')
          .values({
            tenant_id: space.tenant_id,
            participant_id: participant.id,
            resource_name: session.name,
            starts_at: new Date(session.startTime),
            ends_at: session.endTime ? new Date(session.endTime) : null,
          })
          .onConflict((oc) =>
            oc.columns(['participant_id', 'resource_name']).doUpdateSet({
              starts_at: new Date(session.startTime),
              ends_at: session.endTime ? new Date(session.endTime) : null,
            }),
          )
          .execute();
      }
      await next(result.next);
      if (!result.next)
        await db
          .updateTable('google_meet_participants')
          .set({ sessions_synced_at: new Date() })
          .where('id', '=', participant.id)
          .execute();
      return;
    }
    if (job.kind === 'notes') {
      const artifact = await db
        .selectFrom('google_meet_artifacts')
        .selectAll()
        .where('id', '=', job.artifact_id ?? '')
        .where('record_id', '=', record.id)
        .where('kind', '=', 'smart_notes')
        .executeTakeFirst();
      if (!artifact?.document_id || !space.scopes.includes(GOOGLE_DRIVE_MEET_SCOPE)) return;
      const text = await google.noteText(access, artifact.document_id);
      await db
        .updateTable('google_meet_artifacts')
        .set({
          body_text: text,
          entries_status: 'complete',
          entries_error: null,
          last_sync_at: new Date(),
        })
        .where('id', '=', artifact.id)
        .execute();
      return;
    }
    if (job.kind === 'entries') {
      const artifact = await db
        .selectFrom('google_meet_artifacts')
        .select('id')
        .where('id', '=', job.artifact_id ?? '')
        .where('record_id', '=', record.id)
        .where('resource_name', '=', job.resource)
        .executeTakeFirst();
      if (!artifact) return;
      const result = await google.page(
        access,
        job.resource + '/entries',
        'transcriptEntries',
        meetEntrySchema,
        pageQuery(job),
      );
      for (const entry of result.items) {
        if (
          !entry.name.startsWith(job.resource + '/entries/') ||
          !entry.participant.startsWith(record.resource_name + '/participants/')
        )
          throw new Error('invalid_google_response');
        const value = {
          participant_resource: entry.participant,
          starts_at: new Date(entry.startTime),
          ends_at: new Date(entry.endTime),
          body_text: entry.text,
          language_code: entry.languageCode ?? null,
        };
        await db
          .insertInto('google_meet_transcript_entries')
          .values({
            tenant_id: space.tenant_id,
            ...value,
            artifact_id: artifact.id,
            resource_name: entry.name,
          })
          .onConflict((oc) => oc.columns(['artifact_id', 'resource_name']).doUpdateSet(value))
          .execute();
      }
      await next(result.next);
      await db
        .updateTable('google_meet_artifacts')
        .set({
          entries_status: result.next ? 'processing' : 'complete',
          entries_error: null,
          last_sync_at: new Date(),
        })
        .where('id', '=', artifact.id)
        .execute();
      return;
    }
    const result = await google.page(
      access,
      record.resource_name + '/' + job.kind,
      job.kind,
      meetArtifactSchema,
      pageQuery(job),
    );
    for (const artifact of result.items) {
      if (!artifact.name.startsWith(record.resource_name + '/' + job.kind + '/'))
        throw new Error('invalid_google_response');
      const document =
        artifact.docsDestination?.document ??
        artifact.driveDestination?.file?.replace(/^files\//, '') ??
        null;
      const value = {
        state: artifact.state,
        starts_at: artifact.startTime ? new Date(artifact.startTime) : null,
        ends_at: artifact.endTime ? new Date(artifact.endTime) : null,
        document_id: document,
        external_url: googleArtifactUrl(
          artifact.docsDestination?.exportUri ?? artifact.driveDestination?.exportUri,
          document,
          job.kind === 'recordings',
        ),
        last_sync_at: new Date(),
      };
      const saved = await db
        .insertInto('google_meet_artifacts')
        .values({
          tenant_id: space.tenant_id,
          ...value,
          record_id: record.id,
          resource_name: artifact.name,
          kind:
            job.kind === 'recordings'
              ? 'recording'
              : job.kind === 'transcripts'
                ? 'transcript'
                : 'smart_notes',
        })
        .onConflict((oc) => oc.columns(['record_id', 'resource_name']).doUpdateSet(value))
        .returningAll()
        .executeTakeFirstOrThrow();
      if (job.kind === 'transcripts' && ['FILE_GENERATED', 'ENDED'].includes(artifact.state))
        await enqueue({
          ...job,
          kind: 'entries',
          artifact_id: saved.id,
          resource: artifact.name,
          page_token: undefined,
        });
      if (
        job.kind === 'smartNotes' &&
        artifact.state === 'FILE_GENERATED' &&
        space.scopes.includes(GOOGLE_DRIVE_MEET_SCOPE)
      )
        await enqueue({
          ...job,
          kind: 'notes',
          artifact_id: saved.id,
          resource: artifact.name,
          page_token: undefined,
        });
    }
    await next(result.next);
    await status(job.kind, { state: result.next ? 'processing' : 'available' });
  } catch (error) {
    const failure = googleFailure(error);
    await db
      .updateTable('google_meet_spaces')
      .set({ sync_status: 'error', sync_error_code: failure.code, sync_error: failure.message })
      .where('id', '=', space.id)
      .execute();
    await status(job.kind, failure);
    if ((job.kind === 'entries' || job.kind === 'notes') && job.artifact_id && record)
      await db
        .updateTable('google_meet_artifacts')
        .set({
          entries_status:
            error instanceof GoogleApiError && error.providerStatus === 404
              ? 'unavailable_or_expired'
              : 'error',
          entries_error: failure.message,
        })
        .where('id', '=', job.artifact_id)
        .where('record_id', '=', record.id)
        .execute();
    throw error;
  } finally {
    // A consent withdrawal may race an already-running HTTP request. Readers also
    // enforce consent; remove anything this last page could have written meanwhile.
    const current = await getMeetPreferences(db, space.tenant_id, space.user_id);
    if (!current.artifacts_consent)
      await db.deleteFrom('google_meet_records').where('space_id', '=', space.id).execute();
  }
}

export async function scheduleMeetSync(
  db: Kysely<DB>,
  enqueue: Enqueue,
  intervalMinutes = 5,
  now = new Date(),
) {
  const spaces = await db.transaction().execute(async (tx) => {
    const rows = await tx
      .selectFrom('google_meet_spaces as s')
      .innerJoin('google_meet_preferences as p', (join) =>
        join.onRef('p.tenant_id', '=', 's.tenant_id').onRef('p.user_id', '=', 's.user_id'),
      )
      .selectAll('s')
      .where('p.sync_enabled', '=', true)
      .where('p.artifacts_consent', '=', true)
      .where('s.next_sync_at', '<=', now)
      .orderBy('s.next_sync_at')
      .limit(20)
      .forUpdate('s')
      .skipLocked()
      .execute();
    for (const row of rows) {
      const events = await tx
        .selectFrom('google_meet_event_links as l')
        .innerJoin('calendar_events as e', 'e.id', 'l.event_id')
        .select(['e.starts_at', 'e.ends_at', 'e.rrule'])
        .where('l.space_id', '=', row.id)
        .execute();
      const recent = await tx
        .selectFrom('google_meet_records')
        .select('starts_at')
        .where('space_id', '=', row.id)
        .orderBy('starts_at', 'desc')
        .executeTakeFirst();
      const next = nextMeetSyncAt(
        events,
        recent?.starts_at ?? null,
        row.last_sync_at,
        now,
        intervalMinutes,
      );
      await tx
        .updateTable('google_meet_spaces')
        .set({ next_sync_at: next })
        .where('id', '=', row.id)
        .execute();
    }
    return rows;
  });
  for (const row of spaces) {
    try {
      await enqueue({
        kind: 'space',
        space_id: row.id,
        connection_id: row.connection_id,
        resource: row.resource_name,
        generation: randomUUID(),
      });
    } catch {
      await db
        .updateTable('google_meet_spaces')
        .set({ next_sync_at: new Date(+now + 60000) })
        .where('id', '=', row.id)
        .execute();
    }
  }
  // Imported personal data has an explicit retention period; calendar events and contacts survive.
  await sql`delete from google_meet_records r using google_meet_spaces s, google_meet_preferences p
    where r.space_id=s.id and p.tenant_id=s.tenant_id and p.user_id=s.user_id
    and coalesce(r.ends_at,r.starts_at) < ${now}::timestamptz - p.retention_days * interval '1 day'`.execute(
    db,
  );
}

export function nextMeetSyncAt(
  events: { starts_at: Date; ends_at: Date; rrule: string | null }[],
  lastConference: Date | null,
  lastSync: Date | null,
  now: Date,
  intervalMinutes = 5,
): Date {
  const recent = lastConference && +now - +lastConference < 48 * 3600000;
  const active = events.some(
    (event) =>
      event.rrule ||
      (+event.starts_at <= +now + 15 * 60000 && +event.ends_at >= +now - 48 * 3600000),
  );
  if (!lastSync || recent || active) return new Date(+now + intervalMinutes * 60000);
  const withinWindow = lastConference && +now - +lastConference < 30 * 86400000;
  const nextEvent = events
    .filter((event) => +event.starts_at > +now)
    .sort((a, b) => +a.starts_at - +b.starts_at)[0];
  return new Date(
    Math.min(
      +now + (withinWindow ? 3600000 : 86400000),
      nextEvent
        ? Math.max(+now + intervalMinutes * 60000, +nextEvent.starts_at - 15 * 60000)
        : Infinity,
    ),
  );
}
