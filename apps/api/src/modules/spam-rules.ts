import { sql, type Transaction } from 'kysely';
import { asJson, audit, type DB } from '@apmail/db';
import { normalizeRuleEmail } from '@apmail/shared';
import type { RequestContext } from '../authz/context.js';

/** Caller serializes spam changes per mailbox and validates sender/folder permissions. */
export async function rememberSpamSenders(
  tx: Transaction<DB>,
  ctx: RequestContext & { tenantId: string },
  mailboxId: string,
  folderId: string,
  senders: string[],
) {
  for (const address of new Set(senders.map(normalizeRuleEmail))) {
    const conditions = [{ field: 'from', operator: 'equals', value: address }];
    const actions = [{ type: 'move_to_folder', folder_id: folderId }];
    const existing = await tx
      .selectFrom('mail_rules')
      .select('id')
      .where('tenant_id', '=', ctx.tenantId)
      .where('mailbox_id', '=', mailboxId)
      .where('scope', '=', 'mailbox')
      .where('deleted_at', 'is', null)
      .where('match_mode', '=', 'all')
      .where(sql<boolean>`conditions = ${asJson(conditions)}::jsonb`)
      .where(sql<boolean>`actions = ${asJson(actions)}::jsonb`)
      .where(sql<boolean>`exceptions = '[]'::jsonb`)
      .forUpdate()
      .executeTakeFirst();
    const values = {
      is_active: true,
      priority: 1,
      stop_processing: true,
      active_from: null,
      active_until: null,
      review_reason: null,
      created_by: ctx.userId,
    };
    const rule = existing
      ? await tx
          .updateTable('mail_rules')
          .set(values)
          .where('id', '=', existing.id)
          .returning('id')
          .executeTakeFirstOrThrow()
      : await tx
          .insertInto('mail_rules')
          .values({
            ...values,
            tenant_id: ctx.tenantId,
            mailbox_id: mailboxId,
            scope: 'mailbox',
            owner_user_id: null,
            name: ('Spam — ' + address).slice(0, 80),
            match_mode: 'all',
            conditions: asJson(conditions),
            exceptions: asJson([]),
            actions: asJson(actions),
          })
          .returning('id')
          .executeTakeFirstOrThrow();
    await audit(tx, {
      tenantId: ctx.tenantId,
      actorId: ctx.userId,
      action: existing ? 'rule.updated' : 'rule.created',
      entityType: 'mail_rule',
      entityId: rule.id,
      metadata: {
        reason: 'spam_sender',
        mailbox_id: mailboxId,
        sender: address,
        target_folder_id: folderId,
      },
      ip: ctx.ip,
    });
  }
}
