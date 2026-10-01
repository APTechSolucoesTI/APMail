import { sql } from 'kysely';
import type { Database } from './threads.js';
import type { NotificationType } from '../types.js';
export function createNotification(
  db: Database,
  value: {
    tenantId: string;
    userId: string;
    type: NotificationType;
    title: string;
    body?: string;
    link?: string;
    payload?: Record<string, unknown>;
  },
) {
  return db
    .insertInto('notifications')
    .values({
      tenant_id: value.tenantId,
      user_id: value.userId,
      type: value.type,
      title: value.title,
      body: (value.body ?? '').slice(0, 200),
      link: value.link ?? null,
      payload: sql`${JSON.stringify(value.payload ?? {})}::jsonb`,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
