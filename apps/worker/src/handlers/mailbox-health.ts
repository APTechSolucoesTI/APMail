import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { audit } from '@apmail/db';
import type { WorkerResources } from '../resources.js';
import type { Mailbox } from '../imap/connect.js';
import { connectionError, connectionErrorKind, connectionRetryDelay } from '../lib/errors.js';

export async function enqueueMailboxRecovery(
  r: WorkerResources,
  box: Pick<
    Mailbox,
    | 'id'
    | 'connection_revision'
    | 'connection_failures'
    | 'connection_failed_at'
    | 'next_connection_attempt_at'
  >,
) {
  return r.queues['mailbox-connection'].add(
    'recover',
    { mailbox_id: box.id },
    {
      jobId: `reconnect~${box.id}~${box.connection_revision}~${box.connection_failed_at?.getTime() ?? 0}~${box.connection_failures}`,
      delay: Math.max(0, (box.next_connection_attempt_at?.getTime() ?? 0) - Date.now()),
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: true,
    },
  );
}

export async function markMailboxError(
  r: WorkerResources,
  box: Mailbox,
  error: unknown,
  host = box.imap_host,
  port = box.imap_port,
) {
  const last_error = connectionError(error, host, port),
    kind = connectionErrorKind(error);
  const result = await r.db.transaction().execute(async (tx) => {
    const current = await tx
      .selectFrom('mailboxes')
      .selectAll()
      .where('id', '=', box.id)
      .where('tenant_id', '=', box.tenant_id)
      .where('deleted_at', 'is', null)
      .where('status', 'in', ['pending', 'active', 'error'])
      .where('connection_revision', '=', box.connection_revision)
      .forUpdate()
      .executeTakeFirst();
    if (!current) return null;
    if (
      current.status === 'error' &&
      current.next_connection_attempt_at &&
      current.next_connection_attempt_at > new Date()
    )
      return null;
    const attempt = current.connection_failures + 1;
    const notify = !current.connection_alerted_at && (kind !== 'transient' || attempt >= 3);
    const row = await tx
      .updateTable('mailboxes')
      .set({
        status: 'error',
        last_error,
        connection_error_kind: kind,
        connection_failures: attempt,
        connection_failed_at: current.connection_failed_at ?? new Date(),
        connection_alerted_at: notify ? new Date() : current.connection_alerted_at,
        next_connection_attempt_at: new Date(Date.now() + connectionRetryDelay(attempt, kind)),
      })
      .where('id', '=', box.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    if (current.status !== 'error' || notify)
      await audit(tx, {
        tenantId: box.tenant_id,
        actorId: null,
        action: 'mailbox.connection_error',
        entityType: 'mailbox',
        entityId: box.id,
        metadata: { last_error, kind, attempt, automatic_recovery: true },
      });
    const notifications = [];
    if (notify) {
      const admins = await tx
        .selectFrom('tenant_members')
        .select('user_id')
        .where('tenant_id', '=', box.tenant_id)
        .where('role', 'in', ['owner', 'admin'])
        .where('status', '=', 'active')
        .execute();
      for (const admin of admins)
        notifications.push(
          await tx
            .insertInto('notifications')
            .values({
              tenant_id: box.tenant_id,
              user_id: admin.user_id,
              type: 'mailbox_error',
              title:
                kind === 'transient'
                  ? 'Reconexão em andamento: ' + box.name
                  : 'Verifique a conexão: ' + box.name,
              body: last_error + ' O APMail continuará tentando automaticamente.',
              link: '/settings/mailboxes/' + box.id,
            })
            .returningAll()
            .executeTakeFirstOrThrow(),
        );
    }
    return { row, notifications };
  });
  if (!result) return;
  r.log.warn(
    { mailbox_id: box.id, kind, attempt: result.row.connection_failures },
    'Conexão interrompida; recuperação automática agendada.',
  );
  await enqueueMailboxRecovery(r, result.row).catch(() =>
    r.log.warn({ mailbox_id: box.id }, 'Reconexão persistida; aguardando recuperação da fila.'),
  );
  for (const notification of result.notifications)
    r.io.to('user:' + notification.user_id).emit('notification:new', { notification });
  r.io
    .to('tenant:' + box.tenant_id)
    .emit('mailbox:status', { mailbox_id: box.id, status: 'error', last_error });
}

export async function markMailboxConnected(r: WorkerResources, box: Mailbox) {
  const row = await r.db.transaction().execute(async (tx) => {
    const changed = await tx
      .updateTable('mailboxes')
      .set({
        status: 'active',
        last_error: null,
        connection_failures: 0,
        connection_error_kind: null,
        connection_failed_at: null,
        connection_alerted_at: null,
        next_connection_attempt_at: null,
      })
      .where('id', '=', box.id)
      .where('tenant_id', '=', box.tenant_id)
      .where('deleted_at', 'is', null)
      .where('status', 'in', ['pending', 'error'])
      .where('connection_revision', '=', box.connection_revision)
      .where(
        sql<boolean>`exists(select 1 from tenants t where t.id=mailboxes.tenant_id and t.deleted_at is null and t.suspended_at is null)`,
      )
      .returning('id')
      .executeTakeFirst();
    if (changed && box.status === 'error')
      await audit(tx, {
        tenantId: box.tenant_id,
        actorId: null,
        action: 'mailbox.connection_restored',
        entityType: 'mailbox',
        entityId: box.id,
        metadata: { automatic_recovery: true },
      });
    return changed;
  });
  if (!row) return false;
  try {
    await r.queues['mailbox-sync'].upsertJobScheduler(
      'sync:' + box.id,
      { every: r.env.WORKER_SYNC_EVERY_SECONDS * 1000 },
      { name: 'sync', data: { mailbox_id: box.id } },
    );
    await r.queues['mailbox-sync'].add(
      'sync',
      { mailbox_id: box.id },
      {
        jobId: 'reconnected~' + box.id + '~' + randomUUID(),
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  } catch {
    r.log.warn(
      { mailbox_id: box.id },
      'Conexão restabelecida; sincronização aguarda recuperação da fila.',
    );
  }
  r.io
    .to('tenant:' + box.tenant_id)
    .emit('mailbox:status', { mailbox_id: box.id, status: 'active', last_error: null });
  return true;
}
