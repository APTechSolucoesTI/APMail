import type { FastifyInstance } from 'fastify';
import { sql, type Kysely } from 'kysely';
import { z } from 'zod';
import { fileReleaseSchema, senderTrustSchema, type SenderTrustInput } from '@apmail/shared';
import {
  Storage,
  releaseFile,
  revokeFileRelease,
  applySenderTrust,
  clearedRelease,
  securityForFiles,
  senderPolicyFindingSql,
  audit,
  type DB,
  type FileSecurityRow,
} from '@apmail/db';
import { requireTenantAdmin, conflict, notFound } from '../authz/context.js';
import type { Resources } from './resources.js';

const idsSchema = z.object({
  file_ids: z
    .array(z.uuid())
    .min(1)
    .max(100)
    .transform((ids) => [...new Set(ids)]),
  reason: z.string().trim().min(8).max(2000),
});
const idSchema = z.object({ id: z.uuid() });
const messages: Record<string, string> = {
  file_release_ineligible: 'Selecione somente anexos bloqueados ou com falha na análise.',
  file_scan_busy: 'Um dos arquivos está sendo analisado. Aguarde e tente novamente.',
  file_release_malware_ack:
    'Confirme expressamente a liberação de um arquivo com ameaça detectada.',
  file_content_changed:
    'O conteúdo de um arquivo mudou. Solicite uma nova análise antes de liberar.',
};
async function validateRule(db: Kysely<DB>, tenant: string, input: SenderTrustInput) {
  if (input.enabled && input.expires_at && +new Date(input.expires_at) <= Date.now())
    throw conflict('A validade deve estar no futuro.');
  if (
    input.mailbox_id &&
    !(await db
      .selectFrom('mailboxes')
      .select('id')
      .where('tenant_id', '=', tenant)
      .where('id', '=', input.mailbox_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst())
  )
    throw notFound();
}
async function createRule(
  db: Kysely<DB>,
  tenant: string,
  actor: string,
  input: SenderTrustInput,
  storage: Storage,
) {
  await validateRule(db, tenant, input);
  const duplicate = await db
    .selectFrom('antivirus_sender_rules')
    .select('id')
    .where('tenant_id', '=', tenant)
    .where('sender', '=', input.sender)
    .where('mailbox_id', 'is not distinct from', input.mailbox_id)
    .executeTakeFirst();
  if (duplicate)
    throw conflict(
      'Já existe uma regra para este remetente e esta caixa. Edite a regra existente.',
    );
  const row = await db
    .insertInto('antivirus_sender_rules')
    .values({
      ...input,
      expires_at: input.expires_at ? new Date(input.expires_at) : null,
      tenant_id: tenant,
      created_by: actor,
      updated_by: actor,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(db, {
    tenantId: tenant,
    actorId: actor,
    action: 'security.sender_trust_created',
    entityType: 'security',
    entityId: row.id,
    metadata: { sender: row.sender, mailbox_id: row.mailbox_id, policy: row.policy },
  });
  await applyExistingTrust(db, storage, row);
  return row;
}
async function applyExistingTrust(
  tx: Kysely<DB>,
  storage: Storage,
  rule: import('kysely').Selectable<DB['antivirus_sender_rules']>,
) {
  if (!rule.enabled || (rule.expires_at && +new Date(rule.expires_at) <= Date.now()))
    return { files: [] as FileSecurityRow[], checked: 0 };
  const rows = await tx
    .selectFrom('file_security as f')
    .innerJoin('messages as m', 'm.id', 'f.message_id')
    .selectAll('f')
    .where('f.tenant_id', '=', rule.tenant_id)
    .where('m.tenant_id', '=', rule.tenant_id)
    .where('m.direction', '=', 'inbound')
    .where('m.deleted_at', 'is', null)
    .where(sql<boolean>`lower(trim(m.from_address))=${rule.sender}`)
    .where('f.kind', '=', 'attachment')
    .where('f.status', 'in', ['infected', 'error'])
    .where(senderPolicyFindingSql('f'))
    .where('f.scanned_at', 'is not', null)
    .where('f.released_at', 'is', null)
    .where((eb) =>
      eb.or([eb('f.mailbox_id', '=', rule.mailbox_id), eb.val(rule.mailbox_id === null)]),
    )
    .where((eb) =>
      eb.or([eb('f.lease_expires_at', 'is', null), eb('f.lease_expires_at', '<', new Date())]),
    )
    .orderBy('f.id')
    .limit(100)
    .forUpdate('f')
    .execute();
  const files: FileSecurityRow[] = [];
  for (const file of rows) {
    const updated = await applySenderTrust(tx, file, storage);
    if (updated.released_at) files.push(updated);
  }
  return { files, checked: rows.length };
}
export async function registerAntivirusTrust(app: FastifyInstance, r: Resources) {
  const prefix = '/api/security/antivirus';
  const storage = new Storage(r.env.STORAGE_DIR, r.db);
  app.get(prefix + '/mailboxes', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'antivirus.view');
    return r.db
      .selectFrom('mailboxes')
      .select(['id', 'name', 'email_address'])
      .where('tenant_id', '=', c.tenantId)
      .where('deleted_at', 'is', null)
      .orderBy('name')
      .execute();
  });
  const emit = (rows: FileSecurityRow[]) => {
    for (const mailbox of new Set(rows.map((row) => row.mailbox_id).filter(Boolean)))
      r.io.to('mailbox:' + mailbox).emit('attachments:changed', { mailbox_id: mailbox });
  };
  app.get(prefix + '/rules', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'antivirus.view');
    const q = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        page_size: z.coerce.number().int().min(1).max(100).default(10),
        search: z.string().max(200).default(''),
      })
      .parse(req.query);
    const base = r.db
      .selectFrom('antivirus_sender_rules as r')
      .leftJoin('mailboxes as b', (join) =>
        join.onRef('b.id', '=', 'r.mailbox_id').onRef('b.tenant_id', '=', 'r.tenant_id'),
      )
      .leftJoin('users as u', 'u.id', 'r.created_by')
      .where('r.tenant_id', '=', c.tenantId)
      .where('r.sender', 'ilike', '%' + q.search + '%');
    const [items, total] = await Promise.all([
      base
        .selectAll('r')
        .select([
          'b.name as mailbox_name',
          'b.email_address as mailbox_email',
          'u.full_name as creator_name',
        ])
        .orderBy('r.created_at', 'desc')
        .limit(q.page_size)
        .offset((q.page - 1) * q.page_size)
        .execute(),
      base.select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow(),
    ]);
    return { items, total: Number(total.n) };
  });
  app.post(prefix + '/rules', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'antivirus.trust'),
      input = senderTrustSchema.parse(req.body);
    return r.db.transaction().execute((tx) => createRule(tx, c.tenantId, c.userId, input, storage));
  });
  app.patch(prefix + '/rules/:id', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'antivirus.trust'),
      { id } = idSchema.parse(req.params),
      input = senderTrustSchema.parse(req.body);
    const result = await r.db.transaction().execute(async (tx) => {
      await validateRule(tx, c.tenantId, input);
      const old = await tx
        .selectFrom('antivirus_sender_rules')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!old) throw notFound();
      const duplicate = await tx
        .selectFrom('antivirus_sender_rules')
        .select('id')
        .where('tenant_id', '=', c.tenantId)
        .where('sender', '=', input.sender)
        .where('mailbox_id', 'is not distinct from', input.mailbox_id)
        .where('id', '!=', id)
        .executeTakeFirst();
      if (duplicate) throw conflict('Já existe uma regra para este remetente e esta caixa.');
      const row = await tx
        .updateTable('antivirus_sender_rules')
        .set({
          ...input,
          expires_at: input.expires_at ? new Date(input.expires_at) : null,
          updated_by: c.userId,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returningAll()
        .executeTakeFirstOrThrow();
      // Revocation is immediate; prior decisions remain in the immutable journal.
      const files = await tx
        .updateTable('file_security')
        .set({ ...clearedRelease, updated_at: new Date() })
        .where('tenant_id', '=', c.tenantId)
        .where('release_rule_id', '=', id)
        .returningAll()
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'security.sender_trust_updated',
        entityType: 'security',
        entityId: id,
        metadata: {
          sender: row.sender,
          enabled: row.enabled,
          policy: row.policy,
          revoked: files.length,
        },
      });
      const applied = await applyExistingTrust(tx, storage, row);
      return { row, files: [...files, ...applied.files] };
    });
    emit(result.files);
    return result.row;
  });
  app.post(prefix + '/rules/:id/apply', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'antivirus.trust'),
      { id } = idSchema.parse(req.params);
    const result = await r.db.transaction().execute(async (tx) => {
      const rule = await tx
        .selectFrom('antivirus_sender_rules')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .executeTakeFirst();
      if (!rule) throw notFound();
      if (!rule.enabled || (rule.expires_at && +new Date(rule.expires_at) <= Date.now()))
        throw conflict('Ative uma regra válida antes de aplicá-la.');
      return applyExistingTrust(tx, storage, rule);
    });
    emit(result.files);
    return { released: result.files.length, checked: result.checked, limit: 100 };
  });
  app.post(prefix + '/releases', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'antivirus.view'),
      input = fileReleaseSchema.parse(req.body);
    requireTenantAdmin(req.ctx, 'antivirus.release');
    if (input.trust_sender) requireTenantAdmin(req.ctx, 'antivirus.trust');
    const rows = await r.db.transaction().execute(async (tx) => {
      const files = await tx
        .selectFrom('file_security')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('id', 'in', input.file_ids)
        .orderBy('id')
        .forUpdate()
        .execute();
      if (files.length !== input.file_ids.length) throw notFound();
      if (input.trust_sender) {
        if (!input.trust_sender.enabled) throw conflict('A regra de confiança deve estar ativa.');
        for (const file of files) {
          const msg =
            file.message_id &&
            (await tx
              .selectFrom('messages')
              .select(['from_address', 'direction', 'mailbox_id'])
              .where('id', '=', file.message_id)
              .where('tenant_id', '=', c.tenantId)
              .where('deleted_at', 'is', null)
              .executeTakeFirst());
          if (
            !msg ||
            msg.direction !== 'inbound' ||
            msg.from_address.trim().toLowerCase() !== input.trust_sender.sender ||
            (input.trust_sender.mailbox_id && msg.mailbox_id !== input.trust_sender.mailbox_id)
          )
            throw conflict(
              'A regra deve corresponder ao remetente e à caixa dos anexos selecionados.',
            );
        }
        await createRule(tx, c.tenantId, c.userId, input.trust_sender, storage);
      }
      const changed: FileSecurityRow[] = [];
      for (const file of files) {
        try {
          changed.push(
            await releaseFile(
              tx,
              storage,
              file,
              c.userId,
              input.reason,
              input.false_positive,
              input.acknowledge_malware,
            ),
          );
        } catch (error) {
          const friendly = error instanceof Error ? messages[error.message] : undefined;
          if (friendly) throw conflict(friendly);
          throw error;
        }
      }
      return changed;
    });
    emit(rows);
    return { released: rows.length };
  });
  app.post(prefix + '/releases/revoke', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'antivirus.view'),
      input = idsSchema.parse(req.body);
    requireTenantAdmin(req.ctx, 'antivirus.release');
    const rows = await r.db.transaction().execute(async (tx) => {
      const files = await tx
        .selectFrom('file_security')
        .selectAll()
        .where('tenant_id', '=', c.tenantId)
        .where('id', 'in', input.file_ids)
        .orderBy('id')
        .forUpdate()
        .execute();
      if (files.length !== input.file_ids.length) throw notFound();
      const changed: FileSecurityRow[] = [];
      for (const file of files)
        changed.push(await revokeFileRelease(tx, file, c.userId, input.reason));
      return changed;
    });
    emit(rows);
    return { revoked: rows.length };
  });
  app.get(prefix + '/decisions', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'antivirus.view'),
      q = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          page_size: z.coerce.number().int().min(1).max(100).default(10),
          file_id: z.uuid().optional(),
        })
        .parse(req.query);
    let base = r.db
      .selectFrom('file_security_decisions as d')
      .innerJoin('file_security as f', 'f.id', 'd.file_id')
      .leftJoin('users as u', 'u.id', 'd.actor_id')
      .where('d.tenant_id', '=', c.tenantId);
    if (q.file_id) base = base.where('d.file_id', '=', q.file_id);
    const [items, total] = await Promise.all([
      base
        .selectAll('d')
        .select(['f.filename', 'u.full_name as actor_name'])
        .orderBy('d.created_at', 'desc')
        .orderBy('d.id')
        .limit(q.page_size)
        .offset((q.page - 1) * q.page_size)
        .execute(),
      base.select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow(),
    ]);
    return { items, total: Number(total.n) };
  });
  app.get(prefix + '/files/:id/release-context', async (req) => {
    const c = requireTenantAdmin(req.ctx, 'antivirus.view'),
      { id } = idSchema.parse(req.params);
    const row = await r.db
      .selectFrom('file_security as f')
      .leftJoin('messages as m', (join) =>
        join.onRef('m.id', '=', 'f.message_id').onRef('m.tenant_id', '=', 'f.tenant_id'),
      )
      .selectAll('f')
      .select(['m.from_address', 'm.direction'])
      .where('f.tenant_id', '=', c.tenantId)
      .where('f.id', '=', id)
      .executeTakeFirst();
    if (!row) throw notFound();
    const security = (await securityForFiles(r.db, [row.storage_key])).get(row.storage_key);
    return {
      ...security,
      id: row.id,
      filename: row.filename,
      kind: row.kind,
      mailbox_id: row.mailbox_id,
      sender: row.direction === 'inbound' ? row.from_address : null,
    };
  });
}
