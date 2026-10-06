import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { ImapFlow } from 'imapflow';
import type { WorkerResources } from '../resources.js';
import type { Mailbox } from './connect.js';
import { readAccountQuota } from './account-quota.js';

export async function refreshProviderQuota(r: WorkerResources, box: Mailbox, imap: ImapFlow) {
  const previous = (
    await sql<{
      checked_at: Date | null;
    }>`select provider_checked_at as checked_at from mailbox_storage_limits where mailbox_id=${box.id}::uuid`.execute(
      r.db,
    )
  ).rows[0];
  if (previous?.checked_at && Date.now() - previous.checked_at.getTime() < 15 * 60000) return;
  try {
    const quota = await readAccountQuota(imap, box.username, box.imap_host);
    const used = quota?.used ?? null;
    const limit = quota?.limit ?? null;
    const status = used !== null && limit !== null ? 'available' : 'unsupported';
    // Account-scoped identity deduplicates repeated connections without merging independent
    // accounts whose provider uses the same opaque root name (often an empty string).
    const identity =
      status === 'available'
        ? createHash('sha256')
            .update(
              JSON.stringify([
                box.imap_host.toLowerCase(),
                box.imap_port,
                box.username,
                quota?.root ?? '',
              ]),
            )
            .digest('hex')
        : null;
    await sql`update mailbox_storage_limits set provider_status=${status},provider_used_bytes=${used}::bigint,provider_limit_bytes=${limit}::bigint,provider_identity=${identity},provider_checked_at=now() where mailbox_id=${box.id}::uuid`.execute(
      r.db,
    );
  } catch {
    await sql`update mailbox_storage_limits set provider_status='error',provider_used_bytes=null,provider_limit_bytes=null,provider_identity=null,provider_checked_at=now() where mailbox_id=${box.id}::uuid`.execute(
      r.db,
    );
    r.log.warn({ mailbox_id: box.id }, 'Não foi possível consultar a cota do provedor.');
  }
}
