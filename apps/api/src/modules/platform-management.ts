import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { auditChanges, readMailboxCredential, writeMailboxCredential } from '@apmail/db';
import {
  signupSchema,
  fullNameSchema,
  emailSchema,
  passwordSchema,
  mailboxSchema,
  memberAccessSchema,
} from '@apmail/shared';
import { ApiError, requireSuperAdmin, notFound, type RequestContext } from '../authz/context.js';
import { hashPassword } from './auth.js';
import { invalidateSessions } from '../plugins/auth.js';
import { assertMailboxConnection } from '../lib/mailbox-probe.js';
import type { Resources } from './resources.js';

type Recorder = (
  context: RequestContext,
  action: string,
  tenantId: string,
  metadata?: Record<string, unknown>,
) => Promise<void>;
const paramsSchema = z.object({ id: z.uuid() });
const configColumns = [
  'receiving_protocol',
  'id',
  'tenant_id',
  'name',
  'email_address',
  'aliases',
  'from_name_template',
  'append_sent_copy',
  'history_classify_days',
  'imap_host',
  'imap_port',
  'imap_secure',
  'smtp_host',
  'smtp_port',
  'smtp_secure',
  'username',
] as const;
const connectionKeys = [
  'imap_host',
  'imap_port',
  'imap_secure',
  'smtp_host',
  'smtp_port',
  'smtp_secure',
  'username',
] as const;

export async function registerPlatformManagement(
  app: FastifyInstance,
  r: Resources,
  record: Recorder,
) {
  app.get('/api/superadmin/tenants/:id', async (req) => {
    requireSuperAdmin(req.ctx);
    const { id } = paramsSchema.parse(req.params);
    const tenant = await r.db
      .selectFrom('tenants')
      .select(['id', 'name', 'slug', 'suspended_at'])
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!tenant) throw notFound();
    return tenant;
  });
  app.post('/api/superadmin/tenants/:id/users', async (req, reply) => {
    const c = requireSuperAdmin(req.ctx),
      { id } = paramsSchema.parse(req.params);
    const b = signupSchema
      .extend({ tenant_role: memberAccessSchema.shape.tenant_role.default('member') })
      .parse(req.body);
    const tenant = await r.db
      .selectFrom('tenants')
      .select('id')
      .where('id', '=', id)
      .where('deleted_at', 'is', null)
      .where('suspended_at', 'is', null)
      .executeTakeFirst();
    if (!tenant) throw notFound();
    if (await r.db.selectFrom('users').select('id').where('email', '=', b.email).executeTakeFirst())
      throw new ApiError(
        409,
        'conflict',
        'Esta conta já existe. Use o convite para vinculá-la à empresa.',
      );
    const passwordHash = await hashPassword(b.password);
    const user = await r.db.transaction().execute(async (tx) => {
      const row = await tx
        .insertInto('users')
        .values({
          full_name: b.full_name,
          email: b.email,
          password_hash: passwordHash,
          current_tenant_id: id,
        })
        .returning(['id', 'full_name', 'email'])
        .executeTakeFirstOrThrow();
      await tx
        .insertInto('tenant_members')
        .values({ tenant_id: id, user_id: row.id, role: b.tenant_role })
        .execute();
      await tx.insertInto('user_preferences').values({ user_id: row.id }).execute();
      return row;
    });
    await record(c, 'platform.user_created', id, { user_id: user.id, tenant_role: b.tenant_role });
    return reply.code(201).send(user);
  });
  app.patch('/api/superadmin/users/:id', async (req) => {
    const c = requireSuperAdmin(req.ctx),
      { id } = paramsSchema.parse(req.params);
    const b = z
      .object({
        tenant_id: z.uuid(),
        full_name: fullNameSchema,
        email: emailSchema,
        password: passwordSchema.optional(),
      })
      .parse(req.body);
    const previous = await r.db
      .selectFrom('users as u')
      .innerJoin('tenant_members as m', 'm.user_id', 'u.id')
      .select(['u.id', 'u.email', 'u.full_name'])
      .where('u.id', '=', id)
      .where('m.tenant_id', '=', b.tenant_id)
      .executeTakeFirst();
    if (!previous) throw notFound();
    if (
      await r.db
        .selectFrom('platform_admins')
        .select('user_id')
        .where('user_id', '=', id)
        .executeTakeFirst()
    )
      throw new ApiError(
        409,
        'platform_only',
        'Esta conta pertence à administração da plataforma.',
      );
    const user = await r.db
      .updateTable('users')
      .set({
        email: b.email,
        full_name: b.full_name,
        ...(b.password ? { password_hash: await hashPassword(b.password) } : {}),
      })
      .where('id', '=', id)
      .returning(['id', 'full_name', 'email'])
      .executeTakeFirstOrThrow();
    if (b.password || previous.email !== b.email) await invalidateSessions(r.db, r.redis, id);
    r.io.in('user:' + id).disconnectSockets(true);
    await record(c, 'platform.user_updated', b.tenant_id, {
      user_id: id,
      changes: auditChanges(previous, user),
      password_changed: !!b.password,
    });
    return user;
  });
  app.get('/api/superadmin/tenants/:id/mailboxes/:mailboxId', async (req) => {
    requireSuperAdmin(req.ctx);
    const { id, mailboxId } = paramsSchema.extend({ mailboxId: z.uuid() }).parse(req.params);
    const box = await r.db
      .selectFrom('mailboxes')
      .select(configColumns)
      .where('tenant_id', '=', id)
      .where('id', '=', mailboxId)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!box) throw notFound();
    return box;
  });
  app.patch('/api/superadmin/mailboxes/:id', async (req) => {
    const c = requireSuperAdmin(req.ctx),
      { id } = paramsSchema.parse(req.params);
    const b = mailboxSchema
      .partial()
      .omit({ members: true, sync_days: true, receiving_protocol: true })
      .extend({
        tenant_id: z.uuid(),
        // PATCH must preserve omitted fields; Zod defaults also run inside optional fields.
        aliases: mailboxSchema.shape.aliases.removeDefault().optional(),
        from_name_template: mailboxSchema.shape.from_name_template.removeDefault().optional(),
        history_classify_days: mailboxSchema.shape.history_classify_days.removeDefault().optional(),
        append_sent_copy: mailboxSchema.shape.append_sent_copy.removeDefault().optional(),
      })
      .refine((body) => Object.keys(body).some((key) => key !== 'tenant_id'), {
        message: 'Informe ao menos um campo para atualizar.',
      })
      .parse(req.body);
    const { tenant_id, password, ...data } = b;
    const box = await r.db
      .selectFrom('mailboxes')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', tenant_id)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!box) throw notFound();
    const changed =
      !!password || connectionKeys.some((key) => key in data && data[key] !== box[key]);
    if (changed && box.receiving_protocol !== 'local')
      await assertMailboxConnection(r.env, {
        ...box,
        ...data,
        password:
          password ??
          (await readMailboxCredential(r.db, tenant_id, id, r.env.CREDENTIALS_ENCRYPTION_KEY)),
      });
    await r.db.transaction().execute(async (tx) => {
      await tx
        .updateTable('mailboxes')
        .set({
          ...data,
          ...(changed && box.receiving_protocol !== 'local'
            ? { status: 'pending' as const, last_error: null }
            : {}),
        })
        .where('id', '=', id)
        .where('tenant_id', '=', tenant_id)
        .execute();
      if (password)
        await writeMailboxCredential(tx, tenant_id, id, password, r.env.CREDENTIALS_ENCRYPTION_KEY);
    });
    if (changed && box.receiving_protocol !== 'local')
      await r.queues['mailbox-connection'].add('connect', { mailbox_id: id });
    r.io.to('tenant:' + tenant_id).emit('mailboxes:changed', {});
    await record(c, 'platform.mailbox_updated', tenant_id, {
      mailbox_id: id,
      changes: auditChanges(box, data),
      password_changed: !!password,
    });
    return { ok: true };
  });
}
