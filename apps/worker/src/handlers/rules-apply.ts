import { isTenantAdmin } from '@apmail/shared';
import { canDelegate } from '@apmail/shared';
import { sql, type Selectable } from 'kysely';
import type { ImapFlow } from 'imapflow';
import { randomUUID } from 'node:crypto';
import {
  asJson,
  audit,
  lockStorageTenant,
  touchThreads,
  sanitizeEmailHtml,
  outboxJobId,
  sendJobOptions,
  assignThread,
  type DB,
  userCanReadThread,
  userCanReadFolder,
} from '@apmail/db';
import {
  can,
  evaluateConditions,
  mailRuleSchema,
  quoteHtml,
  replySubject,
  type MailboxPerm,
  type Address,
} from '@apmail/shared';
import type { WorkerResources } from '../resources.js';
import type { Mailbox } from '../imap/connect.js';
import { transports } from '../imap/connect.js';
import { withMailboxLock } from '../lib/mailbox-lock.js';
import { emitThreads } from '../lib/events.js';
export async function userCanMailbox(
  r: WorkerResources,
  box: Mailbox,
  userId: string,
  perm: MailboxPerm,
) {
  if (perm === 'send' && box.receiving_protocol === 'local') return false;
  const access = await r.db
    .selectFrom('tenant_members as tm')
    .leftJoin('mailbox_members as mm', (j) =>
      j
        .onRef('mm.tenant_id', '=', 'tm.tenant_id')
        .onRef('mm.user_id', '=', 'tm.user_id')
        .on('mm.mailbox_id', '=', box.id),
    )
    .innerJoin('tenants as tenant', 'tenant.id', 'tm.tenant_id')
    .select(['tm.role', 'tm.capabilities', 'mm.role as mailbox_role'])
    .where('tm.tenant_id', '=', box.tenant_id)
    .where('tm.user_id', '=', userId)
    .where('tm.status', '=', 'active')
    .where('tenant.suspended_at', 'is', null)
    .where('tenant.deleted_at', 'is', null)
    .executeTakeFirst();
  return (
    !!access &&
    (isTenantAdmin(access.role) ||
      can(access.mailbox_role, perm) ||
      (!!access.mailbox_role && canDelegate(access.role, access.capabilities, perm)))
  );
}
type RuleRow = Selectable<DB['mail_rules']>;
async function applyRule(
  r: WorkerResources,
  box: Mailbox,
  client: ImapFlow | null,
  row: RuleRow,
  messageId: string,
) {
  const parsed = mailRuleSchema.safeParse(row);
  if (!parsed.success) {
    r.log.warn({ rule_id: row.id }, 'Regra inválida ignorada.');
    return false;
  }
  const rule = parsed.data;
  if (
    row.scope === 'personal' &&
    (!row.owner_user_id || !(await userCanMailbox(r, box, row.owner_user_id, 'read')))
  )
    return false;
  if (
    row.scope === 'mailbox' &&
    (!row.created_by || !(await userCanMailbox(r, box, row.created_by, 'rules')))
  )
    return false;
  const initialMessage = await r.db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', messageId)
    .where('tenant_id', '=', box.tenant_id)
    .where('mailbox_id', '=', box.id)
    .where('direction', '=', 'inbound')
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!initialMessage) return false;
  const actor = row.scope === 'personal' ? row.owner_user_id : row.created_by;
  if (
    !actor ||
    !(await userCanReadThread(
      r.db,
      box.tenant_id,
      box.id,
      actor,
      initialMessage.thread_id,
      initialMessage.id,
    ))
  )
    return false;
  let msg: Selectable<DB['messages']> = initialMessage;
  const sourceFolder = msg.folder_id
    ? await r.db
        .selectFrom('folders')
        .selectAll()
        .where('id', '=', msg.folder_id)
        .where('tenant_id', '=', box.tenant_id)
        .executeTakeFirst()
    : null;
  if (['trash', 'junk'].includes(sourceFolder?.special_use ?? '')) return false;
  if (
    !evaluateConditions(rule, {
      ...msg,
      to_addresses: msg.to_addresses as Address[],
      cc_addresses: msg.cc_addresses as Address[],
    })
  )
    return false;
  for (const action of rule.actions) {
    if (action.type === 'add_label') {
      const appliedGlobal = await r.db.transaction().execute(async (tx) => {
        await lockStorageTenant(tx, box.tenant_id);
        const label = await tx
          .selectFrom('personal_labels')
          .select(['id', 'user_id', 'scope'])
          .where('id', '=', action.label_id)
          .where('tenant_id', '=', box.tenant_id)
          .where('scope', '=', row.scope === 'personal' ? 'personal' : 'tenant')
          .$if(row.scope === 'personal', (q) => q.where('user_id', '=', row.owner_user_id!))
          .where(
            sql<boolean>`(mailbox_mode='all' or exists(select 1 from label_mailboxes lm where lm.label_id=personal_labels.id and lm.tenant_id=personal_labels.tenant_id and lm.mailbox_id=${box.id}))`,
          )
          .executeTakeFirst();
        if (label) {
          const inserted = await tx
            .insertInto('thread_personal_labels')
            .values({
              thread_id: msg.thread_id,
              label_id: label.id,
              tenant_id: box.tenant_id,
              user_id: label.user_id,
              applied_by: actor,
            })
            .onConflict((oc) => oc.columns(['thread_id', 'label_id']).doNothing())
            .returning('label_id')
            .execute();
          if (label.scope === 'tenant' && inserted.length) {
            await audit(tx, {
              tenantId: box.tenant_id,
              actorId: actor,
              action: 'labels.applied',
              entityType: 'thread',
              entityId: msg.thread_id,
              metadata: { added: [label.id], rule_id: row.id },
            });
            return true;
          }
        }
        return false;
      });
      if (appliedGlobal) r.io.to('tenant:' + box.tenant_id).emit('labels:changed', {});
    } else if (action.type === 'pin') {
      await r.db
        .insertInto('thread_user_state')
        .values({
          thread_id: msg.thread_id,
          tenant_id: box.tenant_id,
          user_id: row.owner_user_id!,
          is_pinned: true,
        })
        .onConflict((oc) => oc.columns(['thread_id', 'user_id']).doUpdateSet({ is_pinned: true }))
        .execute();
    } else if (action.type === 'exclude_from_queue') {
      await r.db
        .updateTable('threads')
        .set({ queue_excluded: true })
        .where('id', '=', msg.thread_id)
        .where('tenant_id', '=', box.tenant_id)
        .execute();
    } else if (action.type === 'assign_to') {
      if (await userCanMailbox(r, box, action.user_id, 'send')) {
        const notification = await r.db
          .transaction()
          .execute((tx) => assignThread(tx, msg.thread_id, action.user_id, row.created_by, 'rule'));
        if (notification)
          r.io.to('user:' + notification.user_id).emit('notification:new', { notification });
      } else
        r.log.warn(
          { rule_id: row.id, user_id: action.user_id },
          'Responsável sem permissão de envio; atribuição ignorada.',
        );
    } else if (action.type === 'move_to_folder' || action.type === 'mark_flagged') {
      const folder = msg.folder_id
        ? await r.db
            .selectFrom('folders')
            .selectAll()
            .where('id', '=', msg.folder_id)
            .where('tenant_id', '=', box.tenant_id)
            .where('deleted_at', 'is', null)
            .executeTakeFirst()
        : null;
      const destination =
        action.type === 'move_to_folder'
          ? await r.db
              .selectFrom('folders')
              .selectAll()
              .where('id', '=', action.folder_id)
              .where('tenant_id', '=', box.tenant_id)
              .where('mailbox_id', '=', box.id)
              .where('deleted_at', 'is', null)
              .executeTakeFirst()
          : null;
      if (action.type === 'move_to_folder' && (!destination || destination.id === folder?.id))
        continue;
      if (
        destination &&
        !(await userCanReadFolder(r.db, box.tenant_id, box.id, actor, destination.id))
      )
        continue;
      if (
        folder &&
        (box.receiving_protocol !== 'imap' || msg.source_kind !== 'imap' || folder.is_local)
      ) {
        if (msg.pending_action) throw Error('A mensagem possui uma alteração pendente.');
        const changes =
          action.type === 'mark_flagged' ? { is_flagged: true } : { folder_id: destination!.id };
        await r.db
          .updateTable('messages')
          .set(changes)
          .where('id', '=', msg.id)
          .where('tenant_id', '=', box.tenant_id)
          .execute();
        msg = { ...msg, ...changes };
        continue;
      }
      if (!client || !folder || !msg.imap_uid || msg.pending_action)
        throw Error('A mensagem está aguardando sincronização antes de aplicar a regra.');
      const lock = await client.getMailboxLock(folder.imap_path);
      try {
        if (action.type === 'mark_flagged') {
          await client.messageFlagsAdd([Number(msg.imap_uid)], ['\\Flagged'], { uid: true });
          await r.db
            .updateTable('messages')
            .set({ is_flagged: true })
            .where('id', '=', msg.id)
            .where('tenant_id', '=', box.tenant_id)
            .execute();
          msg = { ...msg, is_flagged: true };
        } else {
          const move = await client.messageMove([Number(msg.imap_uid)], destination!.imap_path, {
              uid: true,
            }),
            uid: number | null = move ? (move.uidMap?.get(Number(msg.imap_uid)) ?? null) : null;
          await r.db
            .updateTable('messages')
            .set({ folder_id: destination!.id, imap_uid: uid })
            .where('id', '=', msg.id)
            .where('tenant_id', '=', box.tenant_id)
            .execute();
          msg = { ...msg, folder_id: destination!.id, imap_uid: uid === null ? null : String(uid) };
        }
      } finally {
        lock.release();
      }
    } else if (action.type === 'forward_to') {
      if (rule.actions.find((a) => a.type === 'forward_to') !== action) continue;
      const recipients = [
        ...new Set(rule.actions.flatMap((a) => (a.type === 'forward_to' ? [a.address] : []))),
      ].map((address) => ({ name: '', address }));
      const tenant = await r.db
        .selectFrom('tenants')
        .select(['settings', 'timezone'])
        .where('id', '=', box.tenant_id)
        .executeTakeFirstOrThrow();
      if (
        !(tenant.settings as { allow_external_auto_forward?: boolean })
          .allow_external_auto_forward ||
        !row.created_by ||
        !(await userCanMailbox(r, box, row.created_by, 'send'))
      )
        continue;
      const files = await r.db
        .selectFrom('attachments')
        .select(['id', 'size_bytes'])
        .where('tenant_id', '=', box.tenant_id)
        .where('message_id', '=', msg.id)
        .execute();
      const limit = (tenant.settings as { max_attachment_mb?: number }).max_attachment_mb ?? 25;
      if (files.reduce((s, f) => s + f.size_bytes, 0) > limit * 1024 * 1024) {
        r.log.warn(
          { rule_id: row.id, message_id: msg.id },
          'Encaminhamento automático excede o limite de anexos.',
        );
        continue;
      }
      const id = randomUUID(),
        job_id = outboxJobId(id, 1),
        body = quoteHtml(
          {
            ...msg,
            reply_to: [],
            body_html: msg.body_html ?? '',
            to_addresses: msg.to_addresses as Address[],
            cc_addresses: msg.cc_addresses as Address[],
          },
          'forward',
          tenant.timezone,
        );
      const outbox = await r.db.transaction().execute(async (tx) => {
        const inserted = await tx
          .insertInto('outbox')
          .values({
            id,
            tenant_id: box.tenant_id,
            mailbox_id: box.id,
            created_by: row.created_by!,
            created_by_rule_id: row.id,
            kind: 'forward',
            thread_id: msg.thread_id,
            reply_to_message_id: msg.id,
            to_addresses: asJson(recipients),
            cc_addresses: asJson([]),
            bcc_addresses: asJson([]),
            subject: replySubject(msg.subject, 'forward'),
            body_html: sanitizeEmailHtml(body, '', false),
            attachments: asJson(
              files.map((f) => ({ source: 'message_attachment', attachment_id: f.id })),
            ),
            status: 'queued',
            send_after: new Date(),
            submit_count: 1,
            job_id,
          })
          .onConflict((oc) =>
            oc
              .columns(['created_by_rule_id', 'reply_to_message_id'])
              .where(sql<boolean>`created_by_rule_id is not null`)
              .doNothing(),
          )
          .returningAll()
          .executeTakeFirst();
        if (inserted) await touchThreads(tx, [msg.thread_id], 'rule', row.created_by);
        return inserted;
      });
      if (outbox) {
        await r.queues['outbox-send'].add('send', { outbox_id: outbox.id }, sendJobOptions(outbox));
        r.io.to('mailbox:' + box.id).emit('outbox:changed', {
          mailbox_id: box.id,
          outbox_id: outbox.id,
          thread_id: msg.thread_id,
          status: outbox.status,
        });
      }
    }
  }
  await r.db
    .transaction()
    .execute((tx) => touchThreads(tx, [msg.thread_id], 'rule', row.created_by));
  if (row.scope === 'personal') {
    r.io
      .to('user:' + row.owner_user_id)
      .emit('threads:changed', { mailbox_id: box.id, thread_ids: [msg.thread_id] });
  } else emitThreads(r, box.id, [msg.thread_id]);
  return true;
}
export async function applyPendingRules(r: WorkerResources, box: Mailbox, client: ImapFlow | null) {
  const rules = await r.db
    .selectFrom('mail_rules')
    .selectAll()
    .where('tenant_id', '=', box.tenant_id)
    .where('mailbox_id', '=', box.id)
    .where('is_active', '=', true)
    .where('deleted_at', 'is', null)
    .orderBy('priority')
    .orderBy('created_at')
    .execute();
  const messages = await r.db
    .selectFrom('messages')
    .select(['id', 'rules_inbox'])
    .where('tenant_id', '=', box.tenant_id)
    .where('mailbox_id', '=', box.id)
    .where('direction', '=', 'inbound')
    .where('rules_applied_at', 'is', null)
    .where('deleted_at', 'is', null)
    .orderBy('message_at')
    .limit(200)
    .execute();
  for (const msg of messages) {
    if (msg.rules_inbox)
      for (const rule of rules.filter((r) => r.scope === 'mailbox')) {
        if ((await applyRule(r, box, client, rule, msg.id)) && rule.stop_processing) break;
      }
    const owners = [
      ...new Set(rules.filter((r) => r.scope === 'personal').map((r) => r.owner_user_id)),
    ];
    for (const owner of owners)
      for (const rule of rules.filter((r) => r.scope === 'personal' && r.owner_user_id === owner)) {
        if ((await applyRule(r, box, client, rule, msg.id)) && rule.stop_processing) break;
      }
    await r.db
      .updateTable('messages')
      .set({ rules_applied_at: new Date() })
      .where('id', '=', msg.id)
      .where('tenant_id', '=', box.tenant_id)
      .execute();
  }
}
export async function handleRulesApply(
  r: WorkerResources,
  ruleId: string,
  sinceDays: number,
  jobId: string,
) {
  const rule = await r.db
    .selectFrom('mail_rules')
    .selectAll()
    .where('id', '=', ruleId)
    .where('is_active', '=', true)
    .where('deleted_at', 'is', null)
    .executeTakeFirst();
  if (!rule) return;
  const tenant = await r.db
    .selectFrom('tenants')
    .select('id')
    .where('id', '=', rule.tenant_id)
    .where('deleted_at', 'is', null)
    .where('suspended_at', 'is', null)
    .executeTakeFirst();
  if (!tenant) return;
  const result = await withMailboxLock(
    r.redis,
    rule.mailbox_id,
    jobId,
    async () => {
      const box = await r.db
        .selectFrom('mailboxes')
        .selectAll()
        .where('id', '=', rule.mailbox_id)
        .where('tenant_id', '=', rule.tenant_id)
        .where('status', '=', 'active')
        .where('deleted_at', 'is', null)
        .executeTakeFirst();
      if (!box) return;
      const t = await transports(r.db, box, r.env);
      try {
        if (box.receiving_protocol === 'imap') await t.imap.connect();
        let cursor = '';
        const since = new Date(Date.now() - Math.min(365, Math.max(1, sinceDays)) * 86400000);
        for (;;) {
          const messages = await r.db
            .selectFrom('messages')
            .select('id')
            .where('tenant_id', '=', box.tenant_id)
            .where('mailbox_id', '=', box.id)
            .where('direction', '=', 'inbound')
            .where('deleted_at', 'is', null)
            .where('message_at', '>=', since)
            .where('id', '>', cursor || '00000000-0000-0000-0000-000000000000')
            .orderBy('id')
            .limit(200)
            .execute();
          if (!messages.length) break;
          for (const msg of messages)
            await applyRule(
              r,
              box,
              box.receiving_protocol === 'imap' ? t.imap : null,
              rule,
              msg.id,
            );
          cursor = messages.at(-1)!.id;
        }
      } finally {
        await t.close();
      }
    },
    30000,
  );
  if (result === 'skipped') throw Error('Caixa ocupada; as regras serão tentadas novamente.');
}
