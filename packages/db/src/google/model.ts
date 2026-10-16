import type { Database } from '../domain/threads.js';
import { asJson } from '../domain/threads.js';
import { meetPreferencesSchema, googleMeetUrl, type MeetPreferences } from '@apmail/shared';
export async function getMeetPreferences(
  db: Database,
  tenant: string,
  user: string,
): Promise<MeetPreferences> {
  return meetPreferencesSchema.parse(
    (await db
      .selectFrom('google_meet_preferences')
      .selectAll()
      .where('tenant_id', '=', tenant)
      .where('user_id', '=', user)
      .executeTakeFirst()) ?? {},
  );
}
export async function storeMeetSpace(
  db: Database,
  owner: { id: string; tenant_id: string; user_id: string },
  space: { name: string; meetingUri: string; config?: Record<string, unknown> },
  created = false,
) {
  const url = googleMeetUrl(space.meetingUri);
  if (!url || !/^spaces\/[a-zA-Z0-9_-]+$/.test(space.name)) throw new Error('invalid_google_space');
  return db
    .insertInto('google_meet_spaces')
    .values({
      connection_id: owner.id,
      tenant_id: owner.tenant_id,
      user_id: owner.user_id,
      resource_name: space.name,
      meeting_url: url,
      config: asJson(space.config ?? {}),
      app_created: created,
    })
    .onConflict((oc) =>
      oc
        .columns(['connection_id', 'resource_name'])
        .doUpdateSet({ meeting_url: url, config: asJson(space.config ?? {}) }),
    )
    .returningAll()
    .executeTakeFirstOrThrow();
}
export async function linkMeetEvent(
  db: Database,
  event: { id: string; tenant_id: string; user_id: string; meeting_url: string | null },
) {
  if (!event.meeting_url) return;
  const spaces = await db
    .selectFrom('google_meet_spaces')
    .select('id')
    .where('tenant_id', '=', event.tenant_id)
    .where('user_id', '=', event.user_id)
    .where('meeting_url', '=', event.meeting_url)
    .execute();
  for (const space of spaces)
    await db
      .insertInto('google_meet_event_links')
      .values({ space_id: space.id, event_id: event.id })
      .onConflict((oc) => oc.columns(['space_id', 'event_id']).doNothing())
      .execute();
}
export function googleArtifactUrl(
  value: string | undefined,
  document?: string | null,
  recording = false,
): string | null {
  if (value) {
    try {
      const url = new URL(value);
      if (
        url.protocol === 'https:' &&
        !url.username &&
        !url.password &&
        ['docs.google.com', 'drive.google.com'].includes(url.hostname)
      )
        return url.href;
    } catch {
      /* no untrusted URL reaches the browser */
    }
  }
  return document && /^[\w-]+$/.test(document)
    ? recording
      ? `https://drive.google.com/file/d/${document}/view`
      : `https://docs.google.com/document/d/${document}/view`
    : null;
}
