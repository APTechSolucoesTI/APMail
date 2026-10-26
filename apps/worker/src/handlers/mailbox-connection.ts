import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import type { WorkerResources } from '../resources.js';
import { transports } from '../imap/connect.js';
import { refreshProviderQuota } from '../imap/provider-quota.js';
import { pop3Client } from './pop3-sync.js';
import { withMailboxLock } from '../lib/mailbox-lock.js';
import { markMailboxError, markMailboxConnected } from './mailbox-health.js';
export { markMailboxError } from './mailbox-health.js';

export async function handleMailboxConnection(r: WorkerResources, mailboxId: string) {
  return withMailboxLock(r.redis, mailboxId, 'connection:' + randomUUID(), async () => {
    const box = await r.db
      .selectFrom('mailboxes')
      .selectAll()
      .where('id', '=', mailboxId)
      .where('deleted_at', 'is', null)
      .where('status', 'in', ['pending', 'error'])
      .where((eb) =>
        eb.or([
          eb('next_connection_attempt_at', 'is', null),
          eb('next_connection_attempt_at', '<=', sql<Date>`now()`),
        ]),
      )
      .executeTakeFirst();
    if (!box || box.receiving_protocol === 'local') return;
    const tenant = await r.db
      .selectFrom('tenants')
      .select('id')
      .where('id', '=', box.tenant_id)
      .where('deleted_at', 'is', null)
      .where('suspended_at', 'is', null)
      .executeTakeFirst();
    if (!tenant) return;
    let transport: Awaited<ReturnType<typeof transports>> | undefined;
    try {
      if (box.receiving_protocol === 'pop3') {
        const pop = await pop3Client(r, box);
        try {
          await pop.connect();
          await pop.list();
          await pop.quit();
        } finally {
          pop.close();
        }
      } else {
        transport = await transports(r.db, box, r.env);
        await transport.imap.connect();
        await refreshProviderQuota(r, box, transport.imap);
      }
      // SMTP is checked during configuration and sending, independently of receiving.
    } catch (error) {
      await markMailboxError(r, box, error);
      return;
    } finally {
      await transport?.close().catch(() => undefined);
    }
    await markMailboxConnected(r, box);
  });
}
