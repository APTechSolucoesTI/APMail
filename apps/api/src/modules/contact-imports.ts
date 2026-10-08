import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { sql } from 'kysely';
import { asJson, lockStorageTenant } from '@apmail/db';
import {
  contactSchema,
  parseContactCsv,
  mapContactCsv,
  parseContactVcf,
  normalizeRuleText,
  type ImportRow,
} from '@apmail/shared';
import { requireTenant, notFound, ApiError, conflict } from '../authz/context.js';
import { contactMode, saveContact, readContact } from './contact-directory.js';
import type { Resources } from './resources.js';
function duplicateContactPredicate(input: ReturnType<typeof contactSchema.parse>, mode: string) {
  const emails = input.emails.map((value) => value.email);
  const phones = [input.phone, ...input.phones.map((value) => value.number)].filter(Boolean);
  const nameMatches = sql<boolean>`lower(unaccent(regexp_replace(btrim(contacts.name),'\\s+',' ','g')))=${normalizeRuleText(input.name)}`;
  const emailMatches = sql<boolean>`exists(select 1 from contact_emails e where e.contact_id=contacts.id and e.email=any(${emails}::text[]))`;
  const phoneMatches = sql<boolean>`(contacts.phone=any(${phones}::text[]) or exists(select 1 from jsonb_array_elements(contacts.phones) p where p->>'number'=any(${phones}::text[])))`;
  return sql<boolean>`(${emailMatches} or (${nameMatches} and (${mode === 'tenant'} or (${emails.length === 0} and ${phoneMatches}))))`;
}
function mergeImportedContact(
  old: Awaited<ReturnType<typeof readContact>>,
  input: ReturnType<typeof contactSchema.parse>,
) {
  const saved = contactSchema.parse(old);
  const fields = Object.fromEntries(
    Object.entries(input).filter(([, value]) => typeof value === 'string' && value.trim()),
  );
  const emails = [...saved.emails];
  for (const email of input.emails) {
    const index = emails.findIndex((value) => value.email === email.email);
    if (index < 0) emails.push(email);
    else emails[index] = { ...emails[index]!, label: email.label || emails[index]!.label };
  }
  const phones = [...saved.phones];
  for (const phone of input.phones) {
    const index = phones.findIndex((value) => value.number === phone.number);
    if (index < 0) phones.push(phone);
    else phones[index] = { ...phones[index]!, label: phone.label || phones[index]!.label };
  }
  // Preserve the existing principal channel and retain additional addresses.
  const principal = <T extends { is_primary?: boolean }>(items: T[]) => {
    const first = Math.max(
      0,
      items.findIndex((value) => value.is_primary),
    );
    return items.map((item, index) => ({ ...item, is_primary: index === first }));
  };
  const addresses = [...saved.addresses];
  for (const address of input.addresses) {
    if (!addresses.some((value) => JSON.stringify(value) === JSON.stringify(address)))
      addresses.push(address);
  }
  return contactSchema.parse({
    ...saved,
    ...fields,
    emails: principal(emails),
    phones: principal(phones),
    addresses,
    nickname: old.nickname,
    expected_version: old.version,
  });
}
export async function registerContactImports(app: FastifyInstance, r: Resources) {
  app.post('/api/contacts/import/preview', { bodyLimit: 12 * 1024 * 1024 }, async (req) => {
    const c = requireTenant(req.ctx),
      b = z
        .object({
          format: z.enum(['csv', 'vcf']),
          content: z.string().max(10 * 1024 * 1024),
          mapping: z.record(z.string(), z.string()).optional(),
        })
        .parse(req.body);
    if (Buffer.byteLength(b.content, 'utf8') > 10 * 1024 * 1024)
      throw new ApiError(400, 'validation_error', 'O limite é de 10 MiB por arquivo.');
    const mode = await contactMode(r.db, c.tenantId);
    let csv: ReturnType<typeof parseContactCsv> | null, rows: ImportRow[];
    try {
      csv = b.format === 'csv' ? parseContactCsv(b.content) : null;
      rows = csv ? mapContactCsv(csv, b.mapping ?? csv.mapping) : parseContactVcf(b.content);
    } catch (error) {
      throw new ApiError(400, 'invalid_import', (error as Error).message);
    }
    const validRows = rows
        .filter((row) => !row.errors.length)
        .map((row) => contactSchema.parse(row.data)),
      names = validRows.map((row) => normalizeRuleText(row.name)),
      emails = validRows.flatMap((row) => row.emails.map((e) => e.email)),
      phoneValues = validRows.flatMap((row) =>
        [...row.phones.map((value) => value.number), row.phone].filter(Boolean),
      );
    const known = await r.db
      .selectFrom('contacts')
      .select(['contacts.id', 'contacts.name', 'contacts.phones', 'contacts.phone'])
      .select(
        sql<
          string[]
        >`array(select e.email from contact_emails e where e.contact_id=contacts.id)`.as('emails'),
      )
      .where('contacts.tenant_id', '=', c.tenantId)
      .where('contacts.scope', '=', mode)
      .where(
        'contacts.owner_user_id',
        mode === 'personal' ? '=' : 'is',
        mode === 'personal' ? c.userId : null,
      )
      .where(
        sql<boolean>`((lower(unaccent(regexp_replace(btrim(contacts.name),'\\s+',' ','g')))=any(${names}::text[]) and (${mode === 'tenant'} or contacts.phone=any(${phoneValues}::text[]) or exists(select 1 from jsonb_array_elements(contacts.phones) p where p->>'number'=any(${phoneValues}::text[])))) or exists(select 1 from contact_emails e where e.contact_id=contacts.id and e.email=any(${emails}::text[])))`,
      )
      .execute();
    const indexed = new Map<string, Set<string>>();
    const seen = new Set<string>();
    const nameKey = (name: string) => 'name:' + normalizeRuleText(name);
    const phoneKey = (name: string, phone: string) => nameKey(name) + '|phone:' + phone;
    const keysFor = (input: ReturnType<typeof contactSchema.parse>) => [
      ...input.emails.map((value) => 'email:' + value.email),
      ...(mode === 'tenant'
        ? [nameKey(input.name)]
        : input.emails.length
          ? []
          : [input.phone, ...input.phones.map((value) => value.number)]
              .filter(Boolean)
              .map((phone) => phoneKey(input.name, phone))),
    ];
    for (const contact of known) {
      const keys = contact.emails.map((email) => 'email:' + email);
      if (mode === 'tenant') keys.push(nameKey(contact.name));
      else {
        const parsed = contactSchema.safeParse({
          ...contact,
          emails: contact.emails.map((email) => ({ email })),
        });
        if (parsed.success)
          keys.push(
            ...[parsed.data.phone, ...parsed.data.phones.map((value) => value.number)]
              .filter(Boolean)
              .map((phone) => phoneKey(contact.name, phone)),
          );
      }
      for (const key of keys) {
        const ids = indexed.get(key) ?? new Set<string>();
        ids.add(contact.id);
        indexed.set(key, ids);
      }
    }
    for (const row of rows) {
      if (row.errors.length) continue;
      const input = contactSchema.parse(row.data),
        keys = keysFor(input),
        matches = new Set(keys.flatMap((key) => [...(indexed.get(key) ?? [])]));
      Object.assign(row, {
        duplicate:
          matches.size > 1
            ? 'ambiguous'
            : matches.size
              ? 'existing'
              : keys.some((key) => seen.has(key))
                ? 'file'
                : 'new',
      });
      keys.forEach((key) => seen.add(key));
    }

    if (!rows.length) throw new ApiError(400, 'validation_error', 'Nenhum contato encontrado.');
    await r.db
      .deleteFrom('contact_imports')
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('expires_at', '<', new Date())
      .execute();
    const job = await r.db.transaction().execute(async (tx) => {
      await lockStorageTenant(tx, c.tenantId);
      return tx
        .insertInto('contact_imports')
        .values({ tenant_id: c.tenantId, user_id: c.userId, mode, rows: asJson(rows) })
        .returning('id')
        .executeTakeFirstOrThrow();
    });
    return {
      id: job.id,
      mode,
      total: rows.length,
      valid: rows.filter((row) => !row.errors.length).length,
      rows: rows.slice(0, 100),
      headers: csv?.headers,
      mapping: csv?.mapping,
    };
  });
  app.get('/api/contacts/imports', async (req) => {
    const c = requireTenant(req.ctx);
    const items = await r.db
      .selectFrom('contact_imports')
      .select(['id', 'mode', 'cursor', 'created_at', 'expires_at', 'duplicates'])
      .select(sql<number>`jsonb_array_length(rows)`.as('total'))
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('expires_at', '>', new Date())
      .orderBy('created_at', 'desc')
      .limit(20)
      .execute();
    return { items };
  });
  app.get('/api/contacts/import/:id', async (req) => {
    const c = requireTenant(req.ctx),
      id = z.object({ id: z.uuid() }).parse(req.params).id;
    const job = await r.db
      .selectFrom('contact_imports')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', c.tenantId)
      .where('user_id', '=', c.userId)
      .where('expires_at', '>', new Date())
      .executeTakeFirst();
    if (!job) throw notFound();
    return {
      id,
      cursor: job.cursor,
      total: (job.rows as unknown[]).length,
      results: job.results,
      mode: job.mode,
      duplicates: job.duplicates,
      rows: (job.rows as unknown as ImportRow[]).slice(0, 100),
      valid: (job.rows as unknown as ImportRow[]).filter((row) => !row.errors.length).length,
    };
  });
  app.post('/api/contacts/import/:id/confirm', async (req) => {
    const c = requireTenant(req.ctx),
      id = z.object({ id: z.uuid() }).parse(req.params).id,
      b = z.object({ duplicates: z.enum(['skip', 'update']).default('skip') }).parse(req.body);
    for (let batch = 0; batch < 100; batch++) {
      const done = await r.db.transaction().execute(async (tx) => {
        await lockStorageTenant(tx, c.tenantId);
        const job = await tx
          .selectFrom('contact_imports')
          .selectAll()
          .where('id', '=', id)
          .where('tenant_id', '=', c.tenantId)
          .where('user_id', '=', c.userId)
          .where('expires_at', '>', new Date())
          .forUpdate()
          .executeTakeFirst();
        if (!job) throw notFound();
        if ((await contactMode(tx, c.tenantId)) !== job.mode)
          throw conflict(
            'O modo de novos contatos mudou. Faça uma nova prévia antes de confirmar.',
          );
        if (job.duplicates && job.duplicates !== b.duplicates)
          throw conflict('A política de duplicatas não pode ser alterada após o início.');
        if (!job.duplicates)
          await tx
            .updateTable('contact_imports')
            .set({ duplicates: b.duplicates })
            .where('id', '=', id)
            .execute();
        const rows = job.rows as unknown as ImportRow[],
          row = rows[job.cursor];
        if (!row) return true;
        let status = 'invalid',
          message = row.errors.join('; '),
          contactId: string | undefined;
        if (!row.errors.length) {
          const input = contactSchema.parse(row.data),
            matches = await tx
              .selectFrom('contacts')
              .select(['contacts.id', 'contacts.name'])
              .where('contacts.tenant_id', '=', c.tenantId)
              .where('contacts.scope', '=', job.mode)
              .where(
                'contacts.owner_user_id',
                job.mode === 'personal' ? '=' : 'is',
                job.mode === 'personal' ? c.userId : null,
              )
              .where(duplicateContactPredicate(input, job.mode))
              .execute();
          if (matches.length > 1) {
            status = 'ambiguous';
            message = 'Os e-mails ou o nome apontam para contatos diferentes. Revise manualmente.';
          } else if (matches[0] && b.duplicates === 'skip') {
            status = 'skipped';
            message = 'Contato existente ignorado.';
          } else {
            const old = matches[0] ? await readContact(tx, c, matches[0].id) : null;
            await sql`savepoint import_row`.execute(tx);
            try {
              const result = await saveContact(
                tx,
                c,
                old?.id ?? null,
                old ? mergeImportedContact(old, input) : input,
                job.mode,
              );
              status = old ? 'updated' : 'created';
              contactId = result.id;
              message = '';
            } catch (error) {
              await sql`rollback to savepoint import_row`.execute(tx);
              const code = (error as { code?: string }).code;
              if (
                code?.includes('storage') ||
                code?.includes('quota') ||
                (error as Error).message.includes('quota_exceeded') ||
                (error as Error).message.includes('storage_capacity')
              )
                throw error;
              status = 'invalid';
              message =
                error instanceof ApiError ? error.message : 'Não foi possível importar esta linha.';
            }
          }
        }
        const results = [
          ...(job.results as unknown[]),
          { row: row.row, status, message, contact_id: contactId },
        ];
        await tx
          .updateTable('contact_imports')
          .set({ cursor: job.cursor + 1, results: asJson(results) })
          .where('id', '=', id)
          .execute();
        return job.cursor + 1 >= rows.length;
      });
      if (done) break;
    }
    r.io.to('user:' + c.userId).emit('directory:changed', {});
    const job = await r.db
      .selectFrom('contact_imports')
      .select(['cursor', 'rows', 'results', 'mode'])
      .where('id', '=', id)
      .where('user_id', '=', c.userId)
      .where('tenant_id', '=', c.tenantId)
      .executeTakeFirstOrThrow();
    if (job.mode === 'tenant') r.io.to('tenant:' + c.tenantId).emit('directory:changed', {});
    return { cursor: job.cursor, total: (job.rows as unknown[]).length, results: job.results };
  });
}
