import { columnFilters, columnOrder } from './list-columns.js';
import type { FastifyInstance } from 'fastify';
import { sql, type Kysely, type Transaction } from 'kysely';
import { z } from 'zod';
import { asJson, audit, lockStorageTenant, type DB } from '@apmail/db';
import { contactSchema, emailSchema, normalizeRuleText } from '@apmail/shared';
import {
  requireTenant,
  requireCapability,
  notFound,
  conflict,
  ApiError,
  type RequestContext,
} from '../authz/context.js';
import { requireMailboxPerm } from '../authz/guards.js';
import { readableFolders, folderPredicate } from '../authz/folders.js';
import type { Resources } from './resources.js';
import { registerContactImports } from './contact-imports.js';
type Database = Kysely<DB> | Transaction<DB>;
type Context = ReturnType<typeof requireTenant>;
export const contactVisible = (c: Context) =>
  sql<boolean>`contacts.tenant_id=${c.tenantId} and (contacts.scope='tenant' or contacts.owner_user_id=${c.userId})`;
export function contactNickname(c: Context) {
  return sql<string>`coalesce((select n.nickname from contact_user_nicknames n where n.tenant_id=contacts.tenant_id and n.contact_id=contacts.id and n.user_id=${c.userId}),'')`;
}
export function contactSearch(search: string, c: Context) {
  const pattern = '%' + normalizeRuleText(search).replace(/[%_\\]/g, '\\$&') + '%';
  const digits = search.replace(/\D/g, '');
  const predicate = sql<boolean>`(${digits.length >= 2 && /^[\d\s()+.\-/]+$/.test(search)} and exists(select 1 from jsonb_array_elements(contacts.phones) p where regexp_replace(p->>'number','[^0-9]','','g') like ${'%' + digits + '%'})) or lower(unaccent(regexp_replace(concat_ws(' ',contacts.name,contacts.company,contacts.job_title,contacts.phone,contacts.phones::text,${contactNickname(c)}),'\\s+',' ','g'))) like ${pattern} or exists(select 1 from contact_emails e where e.contact_id=contacts.id and e.tenant_id=contacts.tenant_id and e.email ilike ${pattern})`;
  return sql<boolean>`(${predicate})`;
}
export async function readContact(db: Database, c: Context, id: string) {
  const contact = await db
    .selectFrom('contacts')
    .selectAll('contacts')
    .select([
      contactNickname(c).as('nickname'),
      sql<string>`coalesce((select full_name from users where id=contacts.created_by),'Usuário removido')`.as(
        'created_by_name',
      ),
      sql<string>`case when contacts.updated_by is null then 'Não registrado no histórico' else coalesce((select full_name from users where id=contacts.updated_by),'Usuário removido') end`.as(
        'updated_by_name',
      ),
    ])
    .where(contactVisible(c))
    .where('contacts.id', '=', id)
    .executeTakeFirst();
  if (!contact) throw notFound();
  const emails = await db
    .selectFrom('contact_emails')
    .select(['email', 'label', 'is_primary'])
    .where('tenant_id', '=', c.tenantId)
    .where('contact_id', '=', id)
    .orderBy('is_primary', 'desc')
    .orderBy('email')
    .execute();
  return { ...contact, emails };
}
async function nickname(db: Database, c: Context, id: string, value: string) {
  if (!value)
    return db
      .deleteFrom('contact_user_nicknames')
      .where('tenant_id', '=', c.tenantId)
      .where('contact_id', '=', id)
      .where('user_id', '=', c.userId)
      .execute();
  await db
    .insertInto('contact_user_nicknames')
    .values({ tenant_id: c.tenantId, contact_id: id, user_id: c.userId, nickname: value })
    .onConflict((oc) => oc.columns(['contact_id', 'user_id']).doUpdateSet({ nickname: value }))
    .execute();
}
export async function contactMode(db: Database, tenantId: string) {
  const t = await db
    .selectFrom('tenants')
    .select('settings')
    .where('id', '=', tenantId)
    .executeTakeFirstOrThrow();
  return (t.settings as Record<string, unknown>).contact_mode === 'personal'
    ? 'personal'
    : 'tenant';
}
export async function saveContact(
  tx: Transaction<DB>,
  c: Context,
  id: string | null,
  body: unknown,
  expectedMode?: string,
) {
  await lockStorageTenant(tx, c.tenantId);
  const raw = z.record(z.string(), z.unknown()).parse(body);
  if ('scope' in raw || 'owner_user_id' in raw || 'companies' in raw || 'visibility' in raw)
    throw new ApiError(
      400,
      'validation_error',
      'A visibilidade é definida pelo administrador para novos contatos.',
    );
  const b = contactSchema.parse(body),
    old = id ? await readContact(tx, c, id) : null,
    mode = old?.scope ?? (await contactMode(tx, c.tenantId)),
    owner = old?.owner_user_id ?? (mode === 'personal' ? c.userId : null);
  if (expectedMode && mode !== expectedMode)
    throw conflict('O modo da agenda mudou. Revise a importação antes de confirmar.');
  if (old && b.expected_version !== old.version)
    throw conflict('Este contato foi alterado. Reabra a ficha antes de salvar.');
  const agenda = sql<boolean>`contacts.scope=${mode} and contacts.owner_user_id is not distinct from ${owner}::uuid`;
  const duplicateName =
    mode === 'tenant'
      ? await tx
          .selectFrom('contacts')
          .select('id')
          .where('tenant_id', '=', c.tenantId)
          .where(agenda)
          .where(
            sql<boolean>`lower(unaccent(regexp_replace(btrim(contacts.name),'\\s+',' ','g')))=${normalizeRuleText(b.name)}`,
          )
          .$if(!!id, (q) => q.where('contacts.id', '!=', id!))
          .executeTakeFirst()
      : null;
  if (duplicateName)
    throw conflict(
      'Já existe um contato global com este nome. Use o nome completo e o apelido individual.',
    );
  if (b.emails.length) {
    const dupe = await tx
      .selectFrom('contacts')
      .innerJoin('contact_emails as e', 'e.contact_id', 'contacts.id')
      .select('contacts.id')
      .where('contacts.tenant_id', '=', c.tenantId)
      .where(agenda)
      .where(
        'e.email',
        'in',
        b.emails.map((e) => e.email),
      )
      .$if(!!id, (q) => q.where('contacts.id', '!=', id!))
      .executeTakeFirst();
    if (dupe) throw conflict('Um dos e-mails já pertence a outro contato desta agenda.');
  }
  for (const field of ['company', 'job_title'] as const) {
    if (!b[field]) continue;
    const known = await tx
      .selectFrom('contacts')
      .select(field)
      .where(contactVisible(c))
      .where(
        sql<boolean>`lower(unaccent(regexp_replace(btrim(${sql.ref(field)}),'\\s+',' ','g')))=${normalizeRuleText(b[field])}`,
      )
      .orderBy('created_at')
      .executeTakeFirst();
    if (known) b[field] = known[field];
  }
  const phones = b.phones.length
    ? b.phones
    : b.phone
      ? [{ number: b.phone, label: '', is_primary: true }]
      : [];
  if (phones.length && !phones.some((p) => p.is_primary)) phones[0]!.is_primary = true;
  if (b.emails.length && !b.emails.some((e) => e.is_primary)) b.emails[0]!.is_primary = true;
  const { emails, nickname: nick, expected_version: version, addresses, ...fields } = b;
  void version;
  const values = {
    ...fields,
    phone: phones.find((p) => p.is_primary)?.number ?? '',
    phones: asJson(phones),
    addresses: asJson(addresses),
    updated_by: c.userId,
    updated_at: new Date(),
  };
  if (old) {
    const previous = contactSchema.safeParse(old);
    if (previous.success) {
      const comparable = (v: Record<string, unknown>) =>
        JSON.stringify(
          Object.fromEntries(
            Object.entries(v)
              .filter(([key]) => !['nickname', 'expected_version'].includes(key))
              .sort(([a], [b]) => a.localeCompare(b)),
          ),
        );
      if (comparable(previous.data) === comparable({ ...b, phones, phone: values.phone })) {
        if (nick !== undefined) await nickname(tx, c, old.id, nick);
        return { id: old.id, scope: old.scope, nickname_only: true };
      }
    }
  }
  const row = id
    ? await tx
        .updateTable('contacts')
        .set({ ...values, version: sql`version+1` })
        .where('id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .returning('id')
        .executeTakeFirstOrThrow()
    : await tx
        .insertInto('contacts')
        .values({
          ...values,
          tenant_id: c.tenantId,
          created_by: c.userId,
          scope: mode,
          owner_user_id: owner,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
  await tx
    .deleteFrom('contact_emails')
    .where('contact_id', '=', row.id)
    .where('tenant_id', '=', c.tenantId)
    .execute();
  if (emails.length)
    await tx
      .insertInto('contact_emails')
      .values(
        emails.map((e) => ({
          tenant_id: c.tenantId,
          contact_id: row.id,
          email: e.email,
          label: e.label,
          is_primary: e.is_primary ?? false,
          agenda_user_id: owner,
        })),
      )
      .execute();
  if (nick !== undefined) await nickname(tx, c, row.id, nick);
  await audit(tx, {
    tenantId: c.tenantId,
    actorId: c.userId,
    action: id ? 'contact.updated' : 'contact.created',
    entityType: 'contact',
    entityId: row.id,
    metadata: { scope: mode, email_count: emails.length },
    ip: c.ip,
  });
  return { id: row.id, scope: mode };
}
export async function registerContactDirectory(app: FastifyInstance, r: Resources) {
  const idOf = (params: unknown) => z.object({ id: z.uuid() }).parse(params).id;
  const changed = (c: Context, scope: string) =>
    r.io
      .to(scope === 'personal' ? 'user:' + c.userId : 'tenant:' + c.tenantId)
      .emit('directory:changed', {});
  app.get('/api/contacts/mode', async (req) => ({
    mode: await contactMode(r.db, requireTenant(req.ctx).tenantId),
  }));
  app.get('/api/contacts/suggestions', async (req) => {
    const c = requireTenant(req.ctx),
      q = z
        .object({
          field: z.enum(['company', 'job_title']),
          search: z.string().trim().max(200).default(''),
        })
        .parse(req.query);
    const rows = await r.db
      .selectFrom('contacts')
      .select(q.field)
      .distinct()
      .where(contactVisible(c))
      .where(q.field, '!=', '')
      .where(q.field, 'ilike', '%' + q.search.replace(/[%_\\]/g, '\\$&') + '%')
      .orderBy(q.field)
      .limit(30)
      .execute();
    return {
      items: [
        ...new Map(rows.map((row) => [normalizeRuleText(row[q.field]), row[q.field]])).values(),
      ],
    };
  });
  app.get('/api/contacts', async (req) => {
    const c = requireTenant(req.ctx),
      q = z
        .object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce
            .number()
            .refine((n) => [10, 20, 30, 50, 100].includes(n))
            .default(10),
          search: z.string().trim().max(200).default(''),
          email: emailSchema.optional(),
          mailbox_id: z.uuid().optional(),
          sort: z
            .enum([
              'name',
              'company',
              'job_title',
              'phone',
              'nickname',
              'emails',
              'created_at',
              'scope',
            ])
            .default('name'),
          direction: z.enum(['asc', 'desc']).default('asc'),
          columns: z.string().max(10000).optional(),
        })
        .parse(req.query);
    if (q.mailbox_id) await requireMailboxPerm(c, r.db, q.mailbox_id, 'read');
    let base = r.db.selectFrom('contacts').where(contactVisible(c));
    if (q.search) base = base.where(contactSearch(q.search, c));
    if (q.email)
      base = base.where(
        sql<boolean>`exists(select 1 from contact_emails e where e.contact_id=contacts.id and e.email=${q.email})`,
      );
    let rawFilters: unknown;
    try {
      rawFilters = q.columns ? JSON.parse(q.columns) : {};
    } catch {
      throw new ApiError(400, 'validation_error', 'Os filtros de coluna são inválidos.');
    }
    const filters = z
      .partialRecord(
        z.enum([
          'name',
          'company',
          'job_title',
          'phone',
          'nickname',
          'emails',
          'scope',
          'created_at',
        ]),
        z.array(z.string().max(200)).max(1),
      )
      .parse(rawFilters);
    for (const [key, values] of Object.entries(filters)) {
      if (!values[0]) continue;
      const value = '%' + values[0].replace(/[%_\\]/g, '\\$&') + '%';
      if (key === 'emails')
        base = base.where(
          sql<boolean>`exists(select 1 from contact_emails e where e.contact_id=contacts.id and e.email ilike ${value})`,
        );
      else
        base = base.where(
          sql<boolean>`unaccent(${key === 'nickname' ? contactNickname(c) : key === 'scope' ? sql`case contacts.scope when 'tenant' then 'Global' else 'Individual' end` : sql.ref('contacts.' + key)}::text) ilike unaccent(${value})`,
        );
    }
    const total = Number(
      (await base.select((eb) => eb.fn.countAll().as('n')).executeTakeFirstOrThrow()).n,
    );
    const items = await base
      .select([
        'contacts.id',
        'contacts.name',
        'contacts.company',
        'contacts.phone',
        'contacts.job_title',
        'contacts.created_at',
        'contacts.scope',
      ])
      .select([
        contactNickname(c).as('nickname'),
        sql<
          string | null
        >`(select e.email from contact_emails e where e.contact_id=contacts.id order by e.is_primary desc,e.email limit 1)`.as(
          'primary_email',
        ),
        sql<
          string[]
        >`array(select e.email from contact_emails e where e.contact_id=contacts.id order by e.is_primary desc,e.email)`.as(
          'emails',
        ),
      ])
      .orderBy(
        q.sort === 'nickname'
          ? contactNickname(c)
          : q.sort === 'emails'
            ? sql`(select min(e.email) from contact_emails e where e.contact_id=contacts.id)`
            : sql.ref('contacts.' + q.sort),
        q.direction,
      )
      .orderBy('contacts.id')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    return { items, total, page: q.page, pageSize: q.pageSize };
  });
  app.get('/api/contacts/:id', (req) =>
    readContact(r.db, requireTenant(req.ctx), idOf(req.params)),
  );
  app.patch('/api/contacts/:id/nickname', async (req) => {
    const c = requireTenant(req.ctx),
      id = idOf(req.params),
      b = z
        .object({ nickname: z.string().trim().max(120) })
        .strict()
        .parse(req.body);
    await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      await readContact(tx, c, id);
      await nickname(tx, c, id, b.nickname);
    });
    r.io.to('user:' + c.userId).emit('directory:changed', {});
    return b;
  });
  async function save(ctx: RequestContext | null, id: string | null, body: unknown) {
    const c = requireTenant(ctx),
      row = await r.db.transaction().execute((tx) => saveContact(tx, c, id, body));
    changed(c, row.nickname_only ? 'personal' : row.scope);
    return { id: row.id };
  }
  app.post('/api/contacts', async (req, res) =>
    res.code(201).send(await save(req.ctx, null, req.body)),
  );
  app.put('/api/contacts/:id', (req) => save(req.ctx, idOf(req.params), req.body));
  app.delete('/api/contacts/:id', async (req) => {
    const c = requireTenant(req.ctx),
      id = idOf(req.params);
    const scope = await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      const old = await readContact(tx, c, id);
      if (old.scope === 'tenant') requireCapability(c, 'contacts_manage');
      await tx
        .deleteFrom('contacts')
        .where('id', '=', id)
        .where('tenant_id', '=', c.tenantId)
        .execute();
      await audit(tx, {
        tenantId: c.tenantId,
        actorId: c.userId,
        action: 'contact.deleted',
        entityType: 'contact',
        entityId: id,
        metadata: { scope: old.scope },
        ip: c.ip,
      });
      return old.scope;
    });
    changed(c, scope);
    return { ok: true };
  });
  await registerContactImports(app, r);
  app.get('/api/contacts/:id/history', async (req) => {
    const c = requireTenant(req.ctx),
      contact = await readContact(r.db, c, idOf(req.params));
    const q = z
      .object({
        columns: z.string().max(16000).optional(),
        column_sort: z.string().max(80).optional(),
        column_direction: z.enum(['asc', 'desc']).optional(),
        search: z.string().max(200).default(''),
        email: emailSchema.optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce
          .number()
          .int()
          .refine((n) => [10, 20, 30, 50, 100].includes(n))
          .default(10),
      })
      .parse(req.query);
    const emails = q.email ? [q.email] : contact.emails.map((e) => e.email);
    if (q.email && !contact.emails.some((e) => e.email === q.email)) throw notFound();
    const boxes = await r.db
      .selectFrom('mailboxes')
      .select(['id', 'name'])
      .where('tenant_id', '=', c.tenantId)
      .where('deleted_at', 'is', null)
      .execute();
    const grants = [];
    for (const box of boxes) {
      try {
        const scope = await readableFolders(c, r.db, box.id);
        grants.push(sql`(m.mailbox_id=${box.id} and ${folderPredicate(scope)})`);
      } catch (error) {
        if (!(error instanceof ApiError && [403, 404].includes(error.statusCode))) throw error;
      }
    }
    if (!grants.length) return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
    const conditions = sql<boolean>`m.tenant_id=${c.tenantId} and m.deleted_at is null and (${sql.join(grants, sql` or `)}) and (lower(m.from_address)=any(${emails}::text[]) or exists(select 1 from jsonb_array_elements(m.to_addresses||m.cc_addresses) a where lower(a->>'address')=any(${emails}::text[])))`;
    const columns = {
      subject: sql`subject`,
      mailbox_name: sql`mailbox_name`,
      message_at: sql`message_at`,
    };
    const order = columnOrder(q, columns, sql`message_at desc`);
    const result = await sql<{
      items: unknown[];
      total: number;
    }>`with matched as (select distinct on (m.thread_id) m.thread_id,m.mailbox_id,m.subject,m.message_at,b.name as mailbox_name from messages m join mailboxes b on b.id=m.mailbox_id join threads t on t.id=m.thread_id and t.tenant_id=m.tenant_id where ${conditions} and t.deleted_at is null order by m.thread_id,m.message_at desc,m.id), filtered as (select * from matched where ${columnFilters(q, columns)} and (subject ilike ${'%' + q.search + '%'} or mailbox_name ilike ${'%' + q.search + '%'})), paged as (select * from filtered order by ${order},thread_id limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}) select coalesce((select jsonb_agg(p order by ${order},thread_id) from paged p),'[]') as items,(select count(*)::int from filtered) as total`.execute(
      r.db,
    );
    return { ...result.rows[0], page: q.page, pageSize: q.pageSize };
  });
}
