import {
  Pop3Client,
  readMailboxCredential,
  ensureLocalFolders,
  isStorageQuotaError,
} from '@apmail/db';
import { sql } from 'kysely';
import { quotaResumeState, canResumeQuota } from '../imap/quota-checkpoint.js';
import { MAIL_MESSAGE_MAX_BYTES } from '@apmail/shared';
import type { WorkerResources } from '../resources.js';
import { allowInsecure, type Mailbox } from '../imap/connect.js';
import { ingestMessage } from '../imap/ingest-message.js';
import { emitThreads } from '../lib/events.js';
import { applyPendingRules } from './rules-apply.js';
import { markMailboxError } from './mailbox-connection.js';
export async function pop3Client(r: WorkerResources, box: Mailbox) {
  return new Pop3Client({
    host: box.imap_host,
    port: box.imap_port,
    secure: box.imap_secure,
    username: box.username,
    password: await readMailboxCredential(
      r.db,
      box.tenant_id,
      box.id,
      r.env.CREDENTIALS_ENCRYPTION_KEY,
    ),
    allowInsecure: allowInsecure(box.imap_host, r.env),
  });
}
export async function handlePop3Sync(r: WorkerResources, box: Mailbox) {
  const quota = await quotaResumeState(r, box.tenant_id, box.id);
  if (quota && !canResumeQuota(quota)) return;
  const pop = await pop3Client(r, box);
  const affected = new Set<string>();
  try {
    await pop.connect();
    const list = await pop.list();
    if (!box.import_started_at) {
      box.import_started_at = new Date();
      await r.db
        .updateTable('mailboxes')
        .set({ import_started_at: box.import_started_at })
        .where('id', '=', box.id)
        .execute();
    }
    const inbox = await ensureLocalFolders(r.db, box.tenant_id, box.id);
    for (const message of list) {
      if (
        await r.db
          .selectFrom('messages')
          .select('id')
          .where('mailbox_id', '=', box.id)
          .where('source_kind', '=', 'pop3')
          .where('source_key', '=', message.uid)
          .executeTakeFirst()
      )
        continue;
      if (message.size > MAIL_MESSAGE_MAX_BYTES)
        throw new Error(
          'Uma mensagem POP3 excede 50 MiB. A importação preserva o checkpoint para revisão.',
        );
      const source = await pop.retrieve(message.number);
      try {
        affected.add(
          await ingestMessage(
            r,
            box,
            inbox,
            {
              seq: message.number,
              uid: message.number,
              source,
              size: source.length,
              flags: new Set(),
            },
            { kind: 'pop3', key: message.uid, historical: !box.last_synced_at },
          ),
        );
      } catch (error) {
        if (!isStorageQuotaError(error)) throw error;
        const state = await quotaResumeState(r, box.tenant_id, box.id);
        if (!state) throw error;
        await sql`update mailbox_storage_limits set paused_at=now(),sync_checkpoint=${JSON.stringify({ protocol: 'pop3', uidl: message.uid, folder_id: inbox.id, uidvalidity: 'POP3-UIDL', next_uid: message.number, last_uid: 0, tenant_used: state.tenant_used, mailbox_used: state.mailbox_used, tenant_limit: state.tenant_limit, mailbox_limit: state.mailbox_limit, reason: (error as Error).message })}::jsonb where tenant_id=${box.tenant_id}::uuid and mailbox_id=${box.id}::uuid`.execute(
          r.db,
        );
        r.io.to('mailbox:' + box.id).emit('mailbox:storage', { mailbox_id: box.id, paused: true });
        return;
      }
    }
    await applyPendingRules(r, box, null);
    await r.db
      .updateTable('mailboxes')
      .set({ last_synced_at: new Date(), last_error: null })
      .where('id', '=', box.id)
      .execute();
    await sql`update mailbox_storage_limits set paused_at=null,sync_checkpoint=null where mailbox_id=${box.id}::uuid`.execute(
      r.db,
    );
  } catch (error) {
    // Do not log credentials or remote payloads.
    r.log.warn({ mailbox_id: box.id }, 'Sincronização POP3 interrompida.');
    await markMailboxError(r, box, error);
  } finally {
    await pop.quit().catch(() => pop.close());
    emitThreads(r, box.id, [...affected]);
  }
}
