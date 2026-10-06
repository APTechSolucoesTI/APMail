import { createHash } from 'node:crypto';
import { sql } from 'kysely';
import type { ImapFlow } from 'imapflow';
import type { WorkerResources } from '../resources.js';
import type { Mailbox } from './connect.js';

/** ImapFlow has already converted the IMAP STORAGE resource from KiB to bytes. */
export function providerQuotaBytes(value: number | undefined): string | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? String(value)
    : null;
}
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
    const quota = await imap.getQuota('INBOX');
    const used = quota ? providerQuotaBytes(quota.storage?.usage) : null;
    const limit = quota ? providerQuotaBytes(quota.storage?.limit) : null;
    const status =
      used !== null && limit !== null
        ? 'available'
        : imap.capabilities.has('QUOTA')
          ? 'error'
          : 'unsupported';
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
                (quota && quota.quotaRoot) || '',
              ]),
            )
            .digest('hex')
        : null;
    await sql`update mailbox_storage_limits set provider_status=${status},provider_used_bytes=${used}::bigint,provider_limit_bytes=${limit}::bigint,provider_identity=${identity},provider_checked_at=now() where mailbox_id=${box.id}::uuid`.execute(
      r.db,
    );
  } catch {
    await sql`update mailbox_storage_limits set provider_status='error',provider_checked_at=now() where mailbox_id=${box.id}::uuid`.execute(
      r.db,
    );
    r.log.warn({ mailbox_id: box.id }, 'Não foi possível consultar a cota do provedor.');
  }
}
