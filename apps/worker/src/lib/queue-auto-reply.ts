import { randomUUID } from 'node:crypto';
import { sql, type Selectable } from 'kysely';
import { asJson, outboxJobId, sendJobOptions, lockStorageTenant, type DB } from '@apmail/db';
import type { MailRuleInput } from '@apmail/shared';
import type { WorkerResources } from '../resources.js';
import type { Mailbox } from '../imap/connect.js';
import { userCanMailbox } from './mailbox-permissions.js';

export async function queueAutoReply(
  r: WorkerResources,
  box: Mailbox,
  rule: Selectable<DB['mail_rules']>,
  msg: Selectable<DB['messages']>,
  action: Extract<MailRuleInput['actions'][number], { type: 'auto_reply' }>,
) {
  const target = msg.auto_reply_to;
  if (
    !target ||
    !rule.created_by ||
    msg.is_automated ||
    msg.is_mdn ||
    msg.is_historical ||
    !msg.rules_inbox ||
    !msg.folder_id ||
    msg.created_at < rule.created_at ||
    (rule.active_from && msg.created_at < rule.active_from) ||
    !(await userCanMailbox(r, box, rule.created_by, 'send'))
  )
    return;
  if (msg.folder_id) {
    const folder = await r.db
      .selectFrom('folders')
      .select('special_use')
      .where('id', '=', msg.folder_id)
      .where('tenant_id', '=', box.tenant_id)
      .where('mailbox_id', '=', box.id)
      .executeTakeFirst();
    if (!folder || ['junk', 'trash'].includes(folder.special_use ?? '')) return;
  }
  if ([box.email_address, ...box.aliases].some((address) => address.toLowerCase() === target))
    return;
  const now = new Date();
  const outbox = await r.db.transaction().execute(async (tx) => {
    await lockStorageTenant(tx, box.tenant_id);
    await sql`select pg_advisory_xact_lock(hashtext(${box.id + ':' + target}))`.execute(tx);
    const previous = await tx
      .selectFrom('mail_auto_reply_state')
      .select('last_replied_at')
      .where('mailbox_id', '=', box.id)
      .where('tenant_id', '=', box.tenant_id)
      .where('address', '=', target)
      .executeTakeFirst();
    if (previous && +now - +previous.last_replied_at < action.cooldown_hours * 3600000) return null;
    const id = randomUUID();
    const inserted = await tx
      .insertInto('outbox')
      .values({
        id,
        tenant_id: box.tenant_id,
        mailbox_id: box.id,
        created_by: rule.created_by!,
        created_by_rule_id: rule.id,
        is_auto_reply: true,
        kind: 'reply',
        thread_id: msg.thread_id,
        reply_to_message_id: msg.id,
        to_addresses: asJson([{ name: '', address: target }]),
        subject:
          action.subject ||
          ('Resposta automática: ' + msg.subject).replace(/[\r\n\0]/g, ' ').slice(0, 200),
        body_html:
          '<p>' +
          action.message
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replace(/\r?\n/g, '<br>') +
          '</p>',
        status: 'queued',
        send_after: now,
        submit_count: 1,
        job_id: outboxJobId(id, 1),
      })
      .onConflict((oc) =>
        oc
          .columns(['created_by_rule_id', 'reply_to_message_id'])
          .where(sql<boolean>`created_by_rule_id is not null`)
          .doNothing(),
      )
      .returningAll()
      .executeTakeFirst();
    if (!inserted) return null;
    await tx
      .insertInto('mail_auto_reply_state')
      .values({
        tenant_id: box.tenant_id,
        mailbox_id: box.id,
        address: target,
        last_replied_at: now,
        outbox_id: id,
      })
      .onConflict((oc) =>
        oc.columns(['mailbox_id', 'address']).doUpdateSet({ last_replied_at: now, outbox_id: id }),
      )
      .execute();
    return inserted;
  });
  if (outbox) {
    await r.queues['outbox-send']
      .add('send', { outbox_id: outbox.id }, sendJobOptions(outbox))
      .catch(() =>
        r.log.warn({ outbox_id: outbox.id }, 'Resposta salva; recuperação da fila pendente.'),
      );
    r.io.to('mailbox:' + box.id).emit('outbox:changed', {
      mailbox_id: box.id,
      outbox_id: outbox.id,
      thread_id: msg.thread_id,
      status: outbox.status,
    });
  }
}
