import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import {
  decryptSecret,
  postWebhook,
  serializeIntegrationMessages,
  webhookSignature,
} from '@apmail/db';
import type { WorkerResources } from '../resources.js';

const backoff = [60_000, 300_000, 900_000, 3_600_000];
const maxPayloadBytes = 2 * 1024 * 1024;

export async function sweepIntegrationWebhooks(r: WorkerResources) {
  // A crashed process leaves a lease, never an untracked network delivery.
  await sql`update integration_webhook_attempts a set finished_at=now(),error_code='lease_expired'
    from integration_webhook_deliveries d where a.delivery_id=d.id and a.finished_at is null
    and d.state='delivering' and d.lease_expires_at<=now()`.execute(r.db);
  await sql`update integration_webhook_deliveries set state=case when attempts>=max_attempts then 'failed' else 'retry' end,
    lease_token=null,lease_expires_at=null,last_error='lease_expired',next_attempt_at=now()
    where state='delivering' and lease_expires_at<=now()`.execute(r.db);
  const due = await r.db
    .selectFrom('integration_webhook_deliveries')
    .select('id')
    .where('state', 'in', ['pending', 'retry'])
    .where('next_attempt_at', '<=', sql<Date>`now()`)
    .orderBy('next_attempt_at')
    .limit(100)
    .execute();
  for (const row of due)
    await r.queues['integration-webhooks'].add(
      'deliver',
      { delivery_id: row.id },
      {
        jobId: row.id,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
      },
    );
}

export async function handleIntegrationWebhook(
  r: WorkerResources,
  id: string,
  send: typeof postWebhook = postWebhook,
) {
  const claim = await r.db.transaction().execute(async (tx) => {
    const d = await tx
      .selectFrom('integration_webhook_deliveries')
      .selectAll()
      .where('id', '=', id)
      .where('state', 'in', ['pending', 'retry'])
      .where('next_attempt_at', '<=', sql<Date>`now()`)
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!d || d.attempts >= d.max_attempts) return;
    const webhook = await tx
      .selectFrom('integration_webhooks as w')
      .innerJoin('tenants as t', 't.id', 'w.tenant_id')
      .select([
        'w.id',
        'w.tenant_id',
        'w.url',
        'w.enabled',
        'w.events',
        'w.encrypted_secret',
        'w.version',
        't.deleted_at',
        't.suspended_at',
      ])
      .where('w.id', '=', d.webhook_id)
      .where('w.tenant_id', '=', d.tenant_id)
      .executeTakeFirst();
    const event = d.event_id
      ? await tx
          .selectFrom('integration_message_events as e')
          .innerJoin('integration_webhook_mailboxes as b', (j) =>
            j.onRef('b.mailbox_id', '=', 'e.mailbox_id').onRef('b.tenant_id', '=', 'e.tenant_id'),
          )
          .select(['e.message_id', 'e.created_at'])
          .where('e.id', '=', d.event_id)
          .where('e.tenant_id', '=', d.tenant_id)
          .where('b.webhook_id', '=', d.webhook_id)
          .executeTakeFirst()
      : undefined;
    if (
      !webhook ||
      webhook.deleted_at ||
      webhook.suspended_at ||
      webhook.version !== d.webhook_version ||
      !webhook.events.includes(d.event_type) ||
      (!d.is_test && (!webhook.enabled || !event))
    ) {
      await tx
        .updateTable('integration_webhook_deliveries')
        .set({ state: 'cancelled', last_error: 'configuration_changed' })
        .where('id', '=', id)
        .execute();
      return;
    }
    const lease = randomUUID(),
      attempt = d.attempts + 1;
    await tx
      .updateTable('integration_webhook_deliveries')
      .set({
        state: 'delivering',
        attempts: attempt,
        lease_token: lease,
        lease_expires_at: sql<Date>`now()+interval '60 seconds'`,
      })
      .where('id', '=', id)
      .execute();
    await tx
      .insertInto('integration_webhook_attempts')
      .values({ delivery_id: id, number: attempt })
      .execute();
    return { d, webhook, event, lease, attempt };
  });
  if (!claim) return;
  const { d, webhook, event, lease, attempt } = claim;
  let status: number | null = null,
    error: string | null = null;
  try {
    const message = event
      ? (await serializeIntegrationMessages(r.db, d.tenant_id, [event.message_id]))[0]
      : null;
    if (!d.is_test && !message) {
      await r.db
        .updateTable('integration_webhook_deliveries')
        .set({
          state: 'cancelled',
          last_error: 'message_unavailable',
          lease_token: null,
          lease_expires_at: null,
        })
        .where('id', '=', id)
        .where('lease_token', '=', lease)
        .execute();
      await r.db
        .updateTable('integration_webhook_attempts')
        .set({ finished_at: new Date(), error_code: 'message_unavailable' })
        .where('delivery_id', '=', id)
        .where('number', '=', attempt)
        .execute();
      return;
    }
    const payload = {
      event: d.event_type,
      eventId: d.event_key,
      timestamp: (event?.created_at ?? d.created_at).toISOString(),
      test: d.is_test,
      data: message,
    };
    let body = JSON.stringify(payload);
    if (Buffer.byteLength(body) > maxPayloadBytes && message) {
      message.body = null;
      message.bodyIncluded = false;
      body = JSON.stringify(payload);
    }
    if (Buffer.byteLength(body) > maxPayloadBytes) throw new Error('payload_too_large');
    // Recheck configuration immediately before network I/O; updates invalidate queued payloads.
    const current = await r.db
      .selectFrom('integration_webhooks')
      .select('id')
      .where('id', '=', webhook.id)
      .where('version', '=', d.webhook_version)
      .executeTakeFirst();
    if (!current) throw new Error('configuration_changed');
    const timestamp = String(Math.floor(Date.now() / 1000));
    const secret = decryptSecret(webhook.encrypted_secret, r.env.CREDENTIALS_ENCRYPTION_KEY);
    status = await send(webhook.url, body, {
      'X-APMail-Timestamp': timestamp,
      'X-APMail-Event-Id': d.event_key,
      'X-APMail-Signature': webhookSignature(secret, timestamp, body),
    });
    if (status < 200 || status >= 300) error = `http_${status}`;
  } catch (cause) {
    const code = cause instanceof Error ? cause.message : '';
    error = [
      'configuration_changed',
      'destination_blocked',
      'dns_timeout',
      'timeout',
      'payload_too_large',
    ].includes(code)
      ? code
      : 'transport_error';
  }
  await r.db.transaction().execute(async (tx) => {
    const cancelled = error === 'configuration_changed';
    await tx
      .updateTable('integration_webhook_deliveries')
      .set({
        state: cancelled
          ? 'cancelled'
          : !error
            ? 'delivered'
            : attempt >= d.max_attempts
              ? 'failed'
              : 'retry',
        last_status: status,
        last_error: error,
        lease_token: null,
        lease_expires_at: null,
        delivered_at: !error ? sql<Date>`now()` : null,
        next_attempt_at: sql<Date>`now()+${backoff[Math.min(Math.max(0, attempt - (d.max_attempts - 5) - 1), backoff.length - 1)]!} * interval '1 millisecond'`,
      })
      .where('id', '=', id)
      .where('lease_token', '=', lease)
      .execute();
    await tx
      .updateTable('integration_webhook_attempts')
      .set({ finished_at: new Date(), http_status: status, error_code: error })
      .where('delivery_id', '=', id)
      .where('number', '=', attempt)
      .execute();
  });
}
