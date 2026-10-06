import { audit } from '@apmail/db';
import type { WorkerResources } from '../resources.js';
import { transports, type Mailbox } from '../imap/connect.js';
import { connectionError } from '../lib/errors.js';
import { refreshProviderQuota } from '../imap/provider-quota.js';
export async function markMailboxError(
  r: WorkerResources,
  box: Mailbox,
  error: unknown,
  host = box.imap_host,
  port = box.imap_port,
) {
  const last_error = connectionError(error, host, port);
  await r.db.transaction().execute(async (trx) => {
    const row = await trx
      .updateTable('mailboxes')
      .set({ status: 'error', last_error })
      .where('id', '=', box.id)
      .where('tenant_id', '=', box.tenant_id)
      .where('status', 'in', ['pending', 'active'])
      .returning('id')
      .executeTakeFirst();
    if (!row) return;
    await audit(trx, {
      tenantId: box.tenant_id,
      actorId: null,
      action: 'mailbox.connection_error',
      entityType: 'mailbox',
      entityId: box.id,
      metadata: { last_error },
    });
    const admins = await trx
      .selectFrom('tenant_members')
      .select('user_id')
      .where('tenant_id', '=', box.tenant_id)
      .where('role', 'in', ['owner', 'admin'])
      .where('status', '=', 'active')
      .execute();
    for (const a of admins) {
      const notification = await trx
        .insertInto('notifications')
        .values({
          tenant_id: box.tenant_id,
          user_id: a.user_id,
          type: 'mailbox_error',
          title: 'Erro de conexão: ' + box.name,
          body: last_error,
          link: '/settings/mailboxes/' + box.id,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      r.io.to('user:' + a.user_id).emit('notification:new', { notification });
    }
  });
  await r.queues['mailbox-sync'].removeJobScheduler('sync:' + box.id);
  r.io
    .to('tenant:' + box.tenant_id)
    .emit('mailbox:status', { mailbox_id: box.id, status: 'error', last_error });
}
export async function handleMailboxConnection(r: WorkerResources, mailboxId: string) {
  const box = await r.db
    .selectFrom('mailboxes')
    .selectAll()
    .where('id', '=', mailboxId)
    .where('deleted_at', 'is', null)
    .where('status', '=', 'pending')
    .executeTakeFirst();
  if (!box) return;
  const tenant = await r.db
    .selectFrom('tenants')
    .select('id')
    .where('id', '=', box.tenant_id)
    .where('deleted_at', 'is', null)
    .where('suspended_at', 'is', null)
    .executeTakeFirst();
  if (!tenant) return;
  const t = await transports(r.db, box, r.env);
  let smtp = false;
  try {
    await t.imap.connect();
    await refreshProviderQuota(r, box, t.imap);
    smtp = true;
    await t.smtp.verify();
    const changed = await r.db
      .updateTable('mailboxes')
      .set({ status: 'active', last_error: null })
      .where('id', '=', box.id)
      .where('status', '=', 'pending')
      .returning('id')
      .executeTakeFirst();
    if (!changed) return;
    await r.queues['mailbox-sync'].upsertJobScheduler(
      'sync:' + box.id,
      { every: r.env.WORKER_SYNC_EVERY_SECONDS * 1000 },
      { name: 'sync', data: { mailbox_id: box.id } },
    );
    await r.queues['mailbox-sync'].add('sync', { mailbox_id: box.id });
    r.io
      .to('tenant:' + box.tenant_id)
      .emit('mailbox:status', { mailbox_id: box.id, status: 'active', last_error: null });
  } catch (error) {
    await markMailboxError(
      r,
      box,
      error,
      smtp ? box.smtp_host : box.imap_host,
      smtp ? box.smtp_port : box.imap_port,
    );
  } finally {
    await t.close();
  }
}
