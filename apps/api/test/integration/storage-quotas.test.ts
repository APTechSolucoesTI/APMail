import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'kysely';
import { createDb, migrate, Storage, lockStorageTenant } from '@apmail/db';
import type { TenantQuota } from '@apmail/shared';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';
vi.mock('../../src/lib/mailbox-probe.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/mailbox-probe.js')>()),
  assertMailboxConnection: vi.fn(async () => ({ imap: true, smtp: true })),
}));
const url = process.env.DATABASE_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw Error('Banco exclusivo de testes obrigatório.');
const tenant = randomUUID(),
  otherTenant = randomUUID(),
  owner = randomUUID(),
  member = randomUUID(),
  platform = randomUUID(),
  box = randomUUID(),
  otherBox = randomUUID(),
  thread = randomUUID();
const db = createDb(url),
  origin = 'http://localhost:5173',
  secret = randomBytes(32).toString('base64'),
  root = join(tmpdir(), 'apmail-quotas-' + tenant);
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: process.env.REDIS_URL_TEST,
    APP_URL: origin,
    SESSION_SECRET: secret,
    CREDENTIALS_ENCRYPTION_KEY: secret,
    STORAGE_DIR: root,
  }),
);
const cookies = new Map<string, string>();
const call = (method: 'GET' | 'PUT' | 'POST', path: string, user: string = owner, body?: unknown) =>
  app.inject({
    method,
    url: path,
    headers: {
      origin,
      cookie: cookies.get(user) ?? '',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { payload: JSON.stringify(body) } : {}),
  });
const quota = async () => {
  const res = await call('GET', `/api/superadmin/tenants/${tenant}/storage`, platform);
  expect(res.statusCode, res.body).toBe(200);
  return res.json<TenantQuota>();
};
const limits = async (cap: string | null, max: number | null = 10) => {
  const res = await call('PUT', `/api/superadmin/tenants/${tenant}/storage-limits`, platform, {
    storage_limit_bytes: cap,
    max_mailboxes: max,
  });
  expect(res.statusCode, res.body).toBe(200);
  return res.json<TenantQuota>();
};
const createBox = (email: string) =>
  call('POST', '/api/mailboxes', owner, {
    name: 'Nova caixa',
    email_address: email,
    imap_host: 'localhost',
    imap_port: 143,
    imap_secure: false,
    smtp_host: 'localhost',
    smtp_port: 25,
    smtp_secure: false,
    username: email,
    password: 'fixture',
  });
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Cotas QA', slug: 'quota-' + tenant },
      { id: otherTenant, name: 'Privada QA', slug: 'quota-' + otherTenant },
    ])
    .execute();
  for (const [user, role] of [
    [owner, 'owner'],
    [member, 'member'],
    [platform, 'owner'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id: user,
        email: user + '@apmail.local',
        full_name: 'QA cotas',
        password_hash: 'session-fixture',
        current_tenant_id: tenant,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tenant, user_id: user, role })
      .execute();
    await db.insertInto('user_preferences').values({ user_id: user }).execute();
    const token = randomBytes(32).toString('base64url');
    await db
      .insertInto('sessions')
      .values({
        user_id: user,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 3600000),
      })
      .execute();
    cookies.set(user, 'apmail_session=' + encodeURIComponent(app.signCookie(token)));
  }
  await db.insertInto('platform_admins').values({ user_id: platform }).execute();
  for (const id of [box, otherBox])
    await db
      .insertInto('mailboxes')
      .values({
        id,
        tenant_id: tenant,
        name: 'QA ' + id,
        email_address: id + '@apmail.local',
        imap_host: 'localhost',
        smtp_host: 'localhost',
        username: 'fixture',
        status: 'active',
      })
      .execute();
  await db
    .insertInto('mailbox_members')
    .values({ tenant_id: tenant, mailbox_id: box, user_id: member, role: 'viewer' })
    .execute();
  await db
    .insertInto('threads')
    .values({ id: thread, tenant_id: tenant, mailbox_id: box })
    .execute();
}, 60000);
afterAll(async () => {
  await app.close();
  await db.destroy();
});
it('isola leitura das cotas, mantém superadmin fora das caixas e restringe edição à plataforma', async () => {
  for (const invalid of ['abc', '-1', '9223372036854775808'])
    expect(
      (
        await call('PUT', `/api/superadmin/tenants/${tenant}/storage-limits`, platform, {
          storage_limit_bytes: invalid,
          max_mailboxes: 2,
        })
      ).statusCode,
    ).toBe(400);
  expect((await call('GET', `/api/mailboxes/${box}/storage`, member)).statusCode).toBe(200);
  expect((await call('GET', `/api/mailboxes/${otherBox}/storage`, member)).statusCode).toBe(404);
  expect((await call('GET', '/api/tenant/storage', member)).statusCode).toBe(403);
  expect((await call('GET', `/api/mailboxes/${box}/storage`, platform)).statusCode).toBe(403);
  expect(
    (
      await call('PUT', `/api/superadmin/tenants/${tenant}/storage-limits`, owner, {
        storage_limit_bytes: '10000',
        max_mailboxes: 2,
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (await call('PUT', '/api/tenant/storage-allocation', member, { mode: 'equal' })).statusCode,
  ).toBe(403);
  expect(
    (await call('GET', `/api/superadmin/tenants/${tenant}/storage`, platform)).body,
  ).not.toMatch(/provider_identity|storage_path|password/);
});
it('divide todos os bytes automaticamente, incluindo valores acima de 2^53', async () => {
  const q = await limits('9007199254740993');
  expect(q.mailboxes.reduce((s, b) => s + BigInt(b.allocated_bytes!), 0n)).toBe(9007199254740993n);
  expect(q.mailboxes.map((b) => BigInt(b.allocated_bytes!)).sort()).toEqual([
    4503599627370496n,
    4503599627370497n,
  ]);
});
it('enforce quantidade máxima mesmo com cadastros concorrentes nos dois caminhos de criação', async () => {
  await limits('50000000000', 3);
  const results = await Promise.all([
    createBox(randomUUID() + '@apmail.local'),
    call('POST', '/api/superadmin/mailboxes', platform, {
      tenant_id: tenant,
      name: 'Nova plataforma',
      email_address: randomUUID() + '@apmail.local',
      imap_host: 'localhost',
      imap_port: 143,
      imap_secure: false,
      smtp_host: 'localhost',
      smtp_port: 25,
      smtp_secure: false,
      username: 'qa',
      password: 'fixture',
    }),
  ]);
  expect(results.map((r) => r.statusCode).sort()).toEqual([201, 409]);
  expect(results.find((r) => r.statusCode === 409)!.json().error.code).toBe(
    'mailbox_count_limit_exceeded',
  );
  expect((await quota()).mailboxes).toHaveLength(3);
}, 60000);
it('preserva cotas manuais e atribui somente o saldo à nova caixa', async () => {
  const q = await limits('50000000000', 5),
    allocations = q.mailboxes.map((b) => ({ mailbox_id: b.mailbox_id, bytes: '10000000000' }));
  const saved = await call('PUT', '/api/tenant/storage-allocation', owner, {
    mode: 'manual',
    allocations,
  });
  expect(saved.statusCode, saved.body).toBe(200);
  const created = await createBox(randomUUID() + '@apmail.local');
  expect(created.statusCode, created.body).toBe(201);
  const after = await quota();
  expect(after.mailboxes.filter((b) => b.allocated_bytes === '10000000000')).toHaveLength(3);
  expect(
    after.mailboxes.find((b) => !allocations.some((a) => a.mailbox_id === b.mailbox_id))
      ?.allocated_bytes,
  ).toBe('20000000000');
  const blocked = await createBox(randomUUID() + '@apmail.local');
  expect(blocked.statusCode, blocked.body).toBe(409);
  expect(blocked.json().error.code).toBe('mailbox_allocation_required');
  const invalid = await call('PUT', '/api/tenant/storage-allocation', owner, {
    mode: 'manual',
    allocations: after.mailboxes.map((b) => ({ mailbox_id: b.mailbox_id, bytes: '50000000000' })),
  });
  expect(invalid.statusCode).toBe(409);
  const foreign = await call('PUT', '/api/tenant/storage-allocation', owner, {
    mode: 'manual',
    allocations: after.mailboxes.map((b, i) => ({
      mailbox_id: i === 0 ? randomUUID() : b.mailbox_id,
      bytes: '1',
    })),
  });
  expect(foreign.statusCode).toBe(409);
}, 60000);
it('bloqueia crescimento de mensagens/arquivos sob concorrência e permite remover dados para liberar espaço', async () => {
  expect(
    (await call('PUT', '/api/tenant/storage-allocation', owner, { mode: 'equal' })).statusCode,
  ).toBe(200);
  await limits(null);
  const storage = new Storage(root, db),
    paths = [
      `attachments/${tenant}/${box}/${randomUUID()}`,
      `attachments/${tenant}/${box}/${randomUUID()}`,
    ];
  const current = (await quota()).used_bytes;
  await limits((BigInt(current) + 1500n).toString());
  // Tenant cap is the constraint for these tenant-owned test files (independent of per-box limits).
  const tenantPaths = paths.map((_, i) => `signatures/${tenant}/${owner}/concurrent-${i}.png`);
  const written = await Promise.allSettled(
    tenantPaths.map((p) => storage.writeFile(p, Buffer.alloc(1000))),
  );
  expect(written.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(written.find((r) => r.status === 'rejected')).toMatchObject({
    reason: { message: 'tenant_storage_quota_exceeded' },
  });
  await expect(storage.writeFile(paths[0]!, Buffer.alloc(1000))).rejects.toThrow(
    'tenant_storage_quota_exceeded',
  );
  await expect(
    db
      .insertInto('messages')
      .values({
        tenant_id: tenant,
        mailbox_id: box,
        thread_id: thread,
        message_id_header: '<' + randomUUID() + '@apmail.local>',
        message_at: new Date(),
        from_address: 'client@apmail.local',
        direction: 'inbound',
        body_text: 'x'.repeat(4000),
      })
      .execute(),
  ).rejects.toThrow('tenant_storage_quota_exceeded');
  for (const path of tenantPaths) await storage.removeFile(path);
  await limits('100000000');
  await storage.writeFile(paths[0]!, Buffer.alloc(1000));
  await storage.removeFile(paths[0]!);
  expect(await storage.inspect(paths[1]!)).toBeNull();
}, 60000);
it('bloqueia cota individual mesmo quando a empresa ainda tem capacidade', async () => {
  const q = await quota();
  const saved = await call('PUT', '/api/tenant/storage-allocation', owner, {
    mode: 'manual',
    allocations: q.mailboxes.map((b) => ({
      mailbox_id: b.mailbox_id,
      bytes: b.mailbox_id === box ? '0' : '10000000',
    })),
  });
  expect(saved.statusCode, saved.body).toBe(200);
  await expect(
    new Storage(root, db).writeFile(
      `attachments/${tenant}/${box}/${randomUUID()}`,
      Buffer.from('arquivo'),
    ),
  ).rejects.toThrow('mailbox_storage_quota_exceeded');
  const failed = await call('POST', '/api/outbox', owner, {
    mailbox_id: box,
    kind: 'new',
    subject: 'Cota cheia',
    to_addresses: [{ name: 'Cliente', address: 'cliente@apmail.local' }],
    body_html: '<p>Mensagem</p>',
  });
  expect(failed.statusCode, failed.body).toBe(409);
  expect(failed.json().error.code).toBe('mailbox_storage_quota_exceeded');
});
it('agrega apenas cotas de provedor conhecidas, deduplicando conexões da mesma conta', async () => {
  await sql`update mailbox_storage_limits set provider_status='unsupported' where tenant_id=${tenant}::uuid`.execute(
    db,
  );
  await sql`update mailbox_storage_limits set provider_status='available',provider_used_bytes=2048,provider_limit_bytes=4096,provider_identity='shared-account',provider_checked_at=now() where mailbox_id in (${box}::uuid,${otherBox}::uuid)`.execute(
    db,
  );
  const q = await quota();
  expect(q.provider).toMatchObject({ used_bytes: '2048', limit_bytes: '4096', known: 2, total: 4 });
  expect(q.mailboxes.filter((b) => b.provider_status === 'unsupported')).toHaveLength(2);
});
it('mantém atribuição idêntica ao inventário ao deduplicar arquivos entre caixas e empresas', async () => {
  await limits(null);
  const identity = 'qa-quota-' + randomUUID(),
    keys = [randomUUID(), randomUUID(), randomUUID()];
  const check = async () => {
    for (const mailbox of [null, box, otherBox]) {
      const r = (
        await sql<{
          actual: string;
          expected: string;
        }>`select storage_quota_usage(${tenant}::uuid,${mailbox}::uuid)::text as actual,
        (coalesce((select sum(body_bytes+metadata_bytes) from storage_logical_payloads where tenant_id=${tenant}::uuid and (${mailbox}::uuid is null or mailbox_id=${mailbox}::uuid)),0)
        +coalesce((select sum(bytes) from storage_quota_files where tenant_id=${tenant}::uuid and (${mailbox}::uuid is null or mailbox_id=${mailbox}::uuid)),0))::text as expected`.execute(
          db,
        )
      ).rows[0]!;
      expect(r.actual).toBe(r.expected);
    }
  };
  try {
    await sql`insert into storage_assets(storage_key,scope,tenant_id,mailbox_id,category,present_bytes,physical_key,state) values(${keys[0]!},'mailbox',${tenant}::uuid,${box}::uuid,'attachment',500,${identity},'present')`.execute(
      db,
    );
    await check();
    await sql`insert into storage_assets(storage_key,scope,tenant_id,mailbox_id,category,present_bytes,physical_key,state) values(${keys[1]!},'mailbox',${tenant}::uuid,${otherBox}::uuid,'attachment',500,${identity},'present')`.execute(
      db,
    );
    await check();
    await sql`insert into storage_assets(storage_key,scope,tenant_id,category,present_bytes,physical_key,state) values(${keys[2]!},'tenant',${otherTenant}::uuid,'attachment',500,${identity},'present')`.execute(
      db,
    );
    await check();
  } finally {
    await db.deleteFrom('storage_assets').where('storage_key', 'in', keys).execute();
  }
});
it('atualiza atribuições operacionais sem esperar o lock de admissão de conteúdo', async () => {
  let entered!: () => void, release!: () => void;
  const locked = new Promise<void>((resolve) => {
      entered = resolve;
    }),
    unlocked = new Promise<void>((resolve) => {
      release = resolve;
    });
  const blocker = db.transaction().execute(async (tx) => {
    await lockStorageTenant(tx, tenant);
    entered();
    await unlocked;
  });
  await locked;
  const updated = db
    .updateTable('threads')
    .set({ assigned_to: owner })
    .where('id', '=', thread)
    .execute();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      updated,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(Error('Atribuição bloqueada pela admissão de conteúdo.')),
          5000,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
    release();
    await blocker;
    await updated;
  }
});
