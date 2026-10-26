import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { sql } from 'kysely';
import sharp from 'sharp';
import { createDb, migrate, registerSecurityFile, Storage, backupMime } from '@apmail/db';
import { buildApp } from '../../src/app.js';
import { envSchema } from '../../src/env.js';
import { hashToken } from '../../src/plugins/auth.js';

const url = process.env.DATABASE_URL_TEST!;
const redis = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test'))
  throw new Error('Use an isolated test database');
const root = resolve('.data', 'antivirus-api-' + randomUUID());
const origin = 'http://localhost:5173';
const db = createDb(url);
const storage = new Storage(root, db);
const tenant = randomUUID(),
  foreignTenant = randomUUID();
const owner = randomUUID(),
  colleague = randomUUID(),
  stranger = randomUUID();
const box = randomUUID(),
  folder = randomUUID(),
  thread = randomUUID(),
  message = randomUUID();
const attachment = randomUUID(),
  inline = randomUUID(),
  signature = randomUUID(),
  upload = randomUUID();
const exportId = randomUUID(),
  exportFile = randomUUID();
const paths = {
  attachment: `attachments/${tenant}/${box}/${message}/${attachment}`,
  inline: `attachments/${tenant}/${box}/${message}/${inline}`,
  upload: `uploads/${tenant}/${box}/${owner}/${upload}`,
  signature: `signatures/${tenant}/${owner}/${signature}.png`,
  avatar: `avatars/${owner}/${randomUUID()}.webp`,
  raw: `mail-raw/${tenant}/${box}/${message}.eml`,
  pst: `mail-exports/${tenant}/${box}/${exportId}/qa.pst`,
};
const cookies = new Map<string, string>();
const app = await buildApp(
  envSchema.parse({
    NODE_ENV: 'test',
    DATABASE_URL: url,
    REDIS_URL: redis,
    APP_URL: origin,
    STORAGE_DIR: root,
    SESSION_SECRET: randomBytes(32).toString('base64'),
    CREDENTIALS_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  }),
);
const call = (
  method: 'GET' | 'POST' | 'PATCH',
  path: string,
  payload?: unknown,
  user = owner,
  headers: Record<string, string> = {},
) =>
  app.inject({
    method,
    url: '/api' + path,
    headers: {
      origin,
      cookie: cookies.get(user)!,
      ...headers,
      ...(payload === undefined || Buffer.isBuffer(payload)
        ? {}
        : { 'content-type': 'application/json' }),
    },
    ...(payload === undefined
      ? {}
      : { payload: Buffer.isBuffer(payload) ? payload : JSON.stringify(payload) }),
  });
const setStatus = async (path: string, status: 'pending' | 'clean' | 'infected' | 'error') => {
  const hash =
    status === 'clean'
      ? createHash('sha256')
          .update(await readFile(resolve(root, path)))
          .digest('hex')
      : null;
  await sql`update file_security set status=${status},sha256=${hash},scanned_at=${status === 'pending' ? null : new Date()},
    threat_name=${status === 'infected' ? 'QA.Blocked.File' : null},error_code=${status === 'error' ? 'timeout' : null},
    engine_version='test',definitions_at=now(),lease_token=null,lease_expires_at=null where storage_key=${path}`.execute(
    db,
  );
};
function multipart(bytes: Buffer, name = 'image.png') {
  const boundary = 'av-' + randomUUID();
  return {
    body: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}
let png: Buffer;
beforeAll(async () => {
  await migrate(url);
  await mkdir(root, { recursive: true });
  await app.ready();
  png = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#1686a7' } })
    .png()
    .toBuffer();
  for (const id of [tenant, foreignTenant])
    await db
      .insertInto('tenants')
      .values({ id, name: 'Antivirus QA', slug: 'av-' + id })
      .execute();
  for (const id of [owner, colleague, stranger]) {
    const tid = id === stranger ? foreignTenant : tenant;
    await db
      .insertInto('users')
      .values({
        id,
        email: `${id}@av.example`,
        full_name: 'QA',
        password_hash: 'fixture',
        current_tenant_id: tid,
      })
      .execute();
    await db.insertInto('user_preferences').values({ user_id: id }).execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tid, user_id: id, role: 'owner' })
      .execute();
    const token = randomBytes(32).toString('base64url');
    await db
      .insertInto('sessions')
      .values({
        user_id: id,
        token_hash: hashToken(token),
        expires_at: new Date(Date.now() + 3600000),
      })
      .execute();
    cookies.set(id, 'apmail_session=' + encodeURIComponent(app.signCookie(token)));
  }
  await db
    .insertInto('mailboxes')
    .values({
      id: box,
      tenant_id: tenant,
      name: 'QA',
      email_address: 'mailbox@av.example',
      username: 'qa',
      imap_host: 'localhost',
      smtp_host: 'localhost',
      status: 'active',
    })
    .execute();
  await db
    .insertInto('folders')
    .values({
      id: folder,
      tenant_id: tenant,
      mailbox_id: box,
      name: 'INBOX',
      imap_path: 'INBOX',
      special_use: 'inbox',
    })
    .execute();
  await db
    .insertInto('threads')
    .values({ id: thread, tenant_id: tenant, mailbox_id: box, subject: 'Body remains readable' })
    .execute();
  await db
    .insertInto('messages')
    .values({
      id: message,
      tenant_id: tenant,
      mailbox_id: box,
      thread_id: thread,
      folder_id: folder,
      subject: 'Body remains readable',
      from_address: 'sender@av.example',
      message_id_header: `<${message}@av.example>`,
      message_at: new Date(),
      source_kind: 'pop3',
      source_key: randomUUID(),
      raw_storage_path: paths.raw,
      body_text: 'Readable message body',
      body_html: '<p>Readable message body</p><img src="cid:qa-image">',
      has_attachments: true,
      direction: 'inbound',
    })
    .execute();
  for (const [id, path, image] of [
    [attachment, paths.attachment, false],
    [inline, paths.inline, true],
  ] as const) {
    const bytes = image ? png : Buffer.from('QUARANTINED-CONTENT');
    await storage.writeFile(path, bytes);
    await db
      .insertInto('attachments')
      .values({
        id,
        tenant_id: tenant,
        mailbox_id: box,
        message_id: message,
        storage_path: path,
        filename: image ? 'inline.png' : 'qa.txt',
        content_type: image ? 'image/png' : 'text/plain',
        size_bytes: bytes.length,
        content_id: image ? 'qa-image' : null,
        is_inline: image,
      })
      .execute();
    await registerSecurityFile(db, {
      storage_key: path,
      tenant_id: tenant,
      mailbox_id: box,
      message_id: message,
      resource_id: id,
      filename: image ? 'inline.png' : 'qa.txt',
      content_type: image ? 'image/png' : 'text/plain',
      size_bytes: bytes.length,
      kind: 'attachment',
    });
  }
  await storage.writeFile(
    paths.raw,
    Buffer.from('Subject: Original raw\r\n\r\nQUARANTINED-CONTENT'),
  );
  await registerSecurityFile(db, {
    storage_key: paths.raw,
    tenant_id: tenant,
    mailbox_id: box,
    message_id: message,
    resource_id: message,
    filename: 'original.eml',
    content_type: 'message/rfc822',
    size_bytes: Number((await storage.inspect(paths.raw))!.size),
    kind: 'mail_raw',
  });
  await storage.writeFile(paths.upload, png);
  await db
    .insertInto('uploads')
    .values({
      id: upload,
      tenant_id: tenant,
      mailbox_id: box,
      user_id: owner,
      filename: 'upload.png',
      content_type: 'image/png',
      size_bytes: png.length,
      storage_path: paths.upload,
    })
    .execute();
  await registerSecurityFile(db, {
    storage_key: paths.upload,
    tenant_id: tenant,
    mailbox_id: box,
    user_id: owner,
    resource_id: upload,
    filename: 'upload.png',
    content_type: 'image/png',
    size_bytes: png.length,
    kind: 'upload',
  });
  await storage.writeFile(paths.signature, png);
  await db
    .insertInto('signature_images')
    .values({
      id: signature,
      tenant_id: tenant,
      user_id: owner,
      storage_path: paths.signature,
      content_type: 'image/png',
      width: 2,
      height: 2,
      size_bytes: png.length,
      legacy_public: true,
    })
    .execute();
  await registerSecurityFile(db, {
    storage_key: paths.signature,
    tenant_id: tenant,
    mailbox_id: null,
    user_id: owner,
    resource_id: signature,
    filename: 'signature.png',
    content_type: 'image/png',
    size_bytes: png.length,
    kind: 'signature_image',
  });
  await storage.writeFile(paths.avatar, png);
  await db
    .updateTable('users')
    .set({ avatar_path: paths.avatar })
    .where('id', '=', owner)
    .execute();
  await registerSecurityFile(db, {
    storage_key: paths.avatar,
    tenant_id: null,
    mailbox_id: null,
    user_id: owner,
    resource_id: owner,
    filename: 'avatar.webp',
    content_type: 'image/webp',
    size_bytes: png.length,
    kind: 'avatar',
  });
  await storage.writeFile(paths.pst, Buffer.from('QUARANTINED-CONTENT'));
  await db
    .insertInto('mail_archive_exports')
    .values({
      id: exportId,
      tenant_id: tenant,
      mailbox_id: box,
      created_by: owner,
      filename: 'qa.pst',
      state: 'ready',
    })
    .execute();
  await db
    .insertInto('mail_archive_export_files')
    .values({
      id: exportFile,
      export_id: exportId,
      tenant_id: tenant,
      mailbox_id: box,
      kind: 'pst',
      filename: 'qa.pst',
      storage_path: paths.pst,
      size_bytes: 19,
    })
    .execute();
  await registerSecurityFile(db, {
    storage_key: paths.pst,
    tenant_id: tenant,
    mailbox_id: box,
    user_id: owner,
    resource_id: exportFile,
    filename: 'qa.pst',
    content_type: 'application/octet-stream',
    size_bytes: 19,
    kind: 'mail_export',
  });
}, 30000);

beforeEach(async () => {
  for (const path of Object.values(paths)) await setStatus(path, 'clean');
});
afterAll(async () => {
  await app.close();
  await db.destroy();
  const allowed = resolve('.data') + sep;
  if (root.startsWith(allowed)) await rm(root, { recursive: true, force: true });
});

it.each(['pending', 'infected', 'error'] as const)(
  'blocks every binary route for %s files',
  async (status) => {
    for (const path of Object.values(paths)) await setStatus(path, status);
    for (const endpoint of [
      `/attachments/${attachment}/download`,
      `/attachments/${inline}/inline`,
      `/uploads/${upload}/image`,
      `/signatures/images/${signature}`,
      `/public/signature-images/${signature}`,
      `/avatars/${owner}`,
      `/mailboxes/${box}/archive-exports/${exportId}/files/${exportFile}`,
    ]) {
      const response = await call('GET', endpoint, undefined, owner, { range: 'bytes=0-4' });
      expect(response.statusCode, endpoint + response.body).toBeGreaterThanOrEqual(400);
      expect(response.body).not.toContain('QUARANTINED-CONTENT');
    }
  },
);

it('keeps clean downloads, previews and ranged PST downloads functional', async () => {
  expect((await call('GET', `/attachments/${attachment}/download`)).body).toBe(
    'QUARANTINED-CONTENT',
  );
  for (const endpoint of [
    `/attachments/${inline}/inline`,
    `/uploads/${upload}/image`,
    `/signatures/images/${signature}`,
    `/public/signature-images/${signature}`,
    `/avatars/${owner}`,
  ]) {
    const response = await call('GET', endpoint);
    expect(response.statusCode, endpoint + response.body).toBe(200);
    expect(response.rawPayload).toEqual(png);
    expect(response.headers['cache-control']).toContain('no-store');
  }
  const response = await call(
    'GET',
    `/mailboxes/${box}/archive-exports/${exportId}/files/${exportFile}`,
    undefined,
    owner,
    { range: 'bytes=0-4' },
  );
  expect(response.statusCode).toBe(206);
  expect(response.body).toBe('QUARA');
});

it('returns only authorized verdict metadata and keeps blocked CID images out of the message map', async () => {
  await setStatus(paths.inline, 'infected');
  const metadata = await call('GET', `/attachments/${inline}/security`);
  expect(metadata.statusCode).toBe(200);
  expect(metadata.json()).toMatchObject({ status: 'infected', threat_name: 'QA.Blocked.File' });
  expect(metadata.body).not.toContain('storage_key');
  expect(
    (await call('GET', `/attachments/${inline}/security`, undefined, stranger)).statusCode,
  ).toBe(404);
  expect((await call('GET', `/uploads/${upload}/security`, undefined, colleague)).statusCode).toBe(
    404,
  );
  expect((await call('GET', `/uploads/${upload}/security`)).json()).toMatchObject({
    status: 'clean',
  });
  const response = await call('GET', `/threads/${thread}`);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().messages[0].body_text).toBe('Readable message body');
  expect(
    response.json().messages[0].attachments.find((file: { id: string }) => file.id === inline)
      .security.status,
  ).toBe('infected');
  expect(response.json().cid_map).not.toHaveProperty('qa-image');
  await setStatus(paths.inline, 'clean');
  expect((await call('GET', `/threads/${thread}`)).json().cid_map).toHaveProperty(
    'qa-image',
    inline,
  );
});

it.each(['mbox', 'eml'])(
  'rejects a whole %s export before headers when any selected attachment or raw MIME is blocked',
  async (format) => {
    for (const blocked of [paths.attachment, paths.raw]) {
      await setStatus(blocked, 'infected');
      const response = await call('GET', `/mailboxes/${box}/archive-export?format=${format}`);
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(response.headers['content-disposition']).toBeUndefined();
      expect(response.body).not.toContain('QUARANTINED-CONTENT');
      await setStatus(blocked, 'clean');
    }
  },
);

it.each(['mbox', 'eml'])('continues exporting clean messages as %s', async (format) => {
  const response = await call('GET', `/mailboxes/${box}/archive-export?format=${format}`);
  expect(response.statusCode, response.body).toBe(200);
  expect(response.headers['content-disposition']).toContain(format === 'eml' ? '.zip' : '.mbox');
  if (format === 'mbox') expect(response.body).toContain('QUARANTINED-CONTENT');
  else expect(response.rawPayload.subarray(0, 2).toString()).toBe('PK');
});

it('checks decoded attachments before returning a clean raw original from backupMime', async () => {
  await setStatus(paths.attachment, 'infected');
  const record = await db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', message)
    .executeTakeFirstOrThrow();
  await expect(backupMime(db, storage, record)).rejects.toMatchObject({ code: 'file_infected' });
});

it('persists outgoing uploads as pending and denies immediate image preview', async () => {
  const file = multipart(png);
  const response = await call('POST', `/uploads?mailbox_id=${box}`, file.body, owner, file.headers);
  expect(response.statusCode, response.body).toBe(201);
  const created = response.json();
  expect(created.security).toMatchObject({ status: 'pending' });
  expect((await call('GET', `/uploads/${created.id}/security`)).json()).toMatchObject({
    status: 'pending',
  });
  expect((await call('GET', `/uploads/${created.id}/image`)).statusCode).toBeGreaterThanOrEqual(
    400,
  );
  const row = await db
    .selectFrom('uploads')
    .selectAll()
    .where('id', '=', created.id)
    .executeTakeFirstOrThrow();
  const result = await sql<{
    status: string;
  }>`select status from file_security where storage_key=${row.storage_path}`.execute(db);
  expect(result.rows[0]?.status).toBe('pending');
});

it('registers normalized signature images and avatars before publishing their locations', async () => {
  const file = multipart(png);
  const image = await call('POST', '/signatures/images', file.body, owner, file.headers);
  expect(image.statusCode, image.body).toBe(200);
  expect(image.json().security.status).toBe('pending');
  expect((await call('GET', '/signatures/images/' + image.json().id)).statusCode).toBe(409);
  const avatar = await call('POST', '/me/avatar', file.body, colleague, file.headers);
  expect(avatar.statusCode, avatar.body).toBe(200);
  expect(avatar.json().security.status).toBe('pending');
  expect((await call('GET', '/avatars/' + colleague)).statusCode).toBe(409);
});

it('registers only completed archive uploads while allowing the import job to remain queued', async () => {
  const content = Buffer.from(
    'Subject: QA archive\r\nFrom: sender@qa.example\r\nTo: mailbox@av.example\r\n\r\n' +
      'archive body '.repeat(20),
  );
  const created = await call('POST', `/mailboxes/${box}/archive-imports`, {
    filename: 'qa.eml',
    size_bytes: content.length,
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id as string;
  const endpoint = `/mailboxes/${box}/archive-imports/${id}/upload`;
  const first = await call('PATCH', endpoint, content.subarray(0, 100), owner, {
    'content-type': 'application/octet-stream',
    'upload-offset': '0',
  });
  expect(first.statusCode, first.body).toBe(200);
  const key = `mail-imports/${tenant}/${box}/${id}.eml`;
  const interim = await sql<{
    n: string;
  }>`select count(*)::text as n from file_security where storage_key=${key}`.execute(db);
  expect(interim.rows[0]?.n).toBe('0');
  const last = await call('PATCH', endpoint, content.subarray(100), owner, {
    'content-type': 'application/octet-stream',
    'upload-offset': '100',
  });
  expect(last.statusCode, last.body).toBe(200);
  expect(last.json()).toMatchObject({ state: 'queued', security: { status: 'pending' } });
  const registered = await sql<{
    kind: string;
    status: string;
  }>`select kind,status from file_security where storage_key=${key}`.execute(db);
  expect(registered.rows[0]).toEqual({ kind: 'mail_import', status: 'pending' });
});

it('rejects changed bytes even when an external write leaves an old clean database verdict intact', async () => {
  const id = randomUUID(),
    path = `uploads/${tenant}/${box}/${owner}/${id}`;
  await storage.writeFile(path, Buffer.from('safe'));
  await db
    .insertInto('uploads')
    .values({
      id,
      tenant_id: tenant,
      mailbox_id: box,
      user_id: owner,
      filename: 'qa.png',
      content_type: 'image/png',
      size_bytes: 4,
      storage_path: path,
    })
    .execute();
  await registerSecurityFile(db, {
    storage_key: path,
    tenant_id: tenant,
    mailbox_id: box,
    user_id: owner,
    resource_id: id,
    filename: 'qa.png',
    content_type: 'image/png',
    size_bytes: 4,
    kind: 'upload',
  });
  await setStatus(path, 'clean');
  await new Storage(root).writeFile(path, Buffer.from('evil'));
  const response = await call('GET', `/uploads/${id}/image`);
  expect(response.statusCode).toBe(409);
  expect(response.body).not.toContain('evil');
  const state = await sql<{
    status: string;
    error_code: string;
  }>`select status,error_code from file_security where storage_key=${path}`.execute(db);
  expect(state.rows[0]).toMatchObject({ status: 'pending', error_code: 'content_changed' });
});

it('allows saving and reopening blocked drafts but refuses submit, retry and send-now before queueing', async () => {
  await setStatus(paths.upload, 'infected');
  const response = await call('POST', '/outbox', {
    mailbox_id: box,
    subject: 'Blocked attachment',
    to_addresses: [{ address: 'recipient@av.example' }],
    body_html: '<p>Draft</p>',
    attachments: [{ source: 'upload', upload_id: upload }],
  });
  expect(response.statusCode, response.body).toBe(201);
  const id = response.json().id as string;
  expect((await call('GET', '/outbox/' + id)).json().attachment_metadata[0].security.status).toBe(
    'infected',
  );
  for (const [action, status] of [
    ['submit', 'draft'],
    ['retry', 'failed'],
    ['send-now', 'scheduled'],
  ] as const) {
    await db.updateTable('outbox').set({ status }).where('id', '=', id).execute();
    expect((await call('POST', `/outbox/${id}/${action}`, {})).statusCode).toBeGreaterThanOrEqual(
      400,
    );
    expect(
      await db
        .selectFrom('outbox')
        .select(['status', 'job_id'])
        .where('id', '=', id)
        .executeTakeFirstOrThrow(),
    ).toMatchObject({ status, job_id: null });
  }
  await db.updateTable('outbox').set({ status: 'draft' }).where('id', '=', id).execute();
  await setStatus(paths.upload, 'clean');
  expect((await call('POST', `/outbox/${id}/submit`, {})).statusCode).toBe(200);
});

it('also blocks signature images that are added to a message without attachment refs', async () => {
  await setStatus(paths.signature, 'pending');
  const response = await call('POST', '/outbox', {
    mailbox_id: box,
    subject: 'Signature only',
    to_addresses: [{ address: 'recipient@av.example' }],
    body_html: `<p>Draft</p><img src="${origin}/api/signatures/images/${signature}">`,
  });
  expect(response.statusCode, response.body).toBe(201);
  const id = response.json().id as string;
  const submit = await call('POST', `/outbox/${id}/submit`, {});
  expect(submit.statusCode, submit.body).toBeGreaterThanOrEqual(400);
  expect(
    (await db.selectFrom('outbox').select('status').where('id', '=', id).executeTakeFirstOrThrow())
      .status,
  ).toBe('draft');
});

it('exposes signature scan state only to its owner without downloading pending bytes', async () => {
  await setStatus(paths.signature, 'pending');
  const path = `/signatures/images/${signature}/security`;
  expect((await call('GET', path)).json()).toMatchObject({ status: 'pending' });
  expect((await call('GET', `/signatures/images/${signature}`)).statusCode).toBe(409);
  expect((await call('GET', path, undefined, colleague)).statusCode).toBe(404);
  expect((await app.inject({ url: '/api' + path })).statusCode).toBe(401);
  await setStatus(paths.signature, 'clean');
  expect((await call('GET', path)).json()).toMatchObject({ status: 'clean' });
});

it('blocks received attachments from being forwarded while retaining an editable draft', async () => {
  await setStatus(paths.attachment, 'infected');
  const draft = await call('POST', '/outbox', {
    mailbox_id: box,
    kind: 'forward',
    thread_id: thread,
    to_addresses: [{ address: 'recipient@av.example' }],
    body_html: '<p>Forward</p>',
    attachments: [{ source: 'message_attachment', attachment_id: attachment }],
  });
  expect(draft.statusCode, draft.body).toBe(201);
  const id = draft.json().id as string;
  expect((await call('GET', `/outbox/${id}`)).json().attachment_metadata[0].security.status).toBe(
    'infected',
  );
  const response = await call('POST', `/outbox/${id}/submit`, {});
  expect(response.statusCode, response.body).toBe(403);
  expect(response.json().error.code).toBe('file_infected');
  expect(
    (await db.selectFrom('outbox').select('status').where('id', '=', id).executeTakeFirstOrThrow())
      .status,
  ).toBe('draft');
});

it.each(['write', 'append', 'truncate', 'copy'] as const)(
  'revokes the current verdict and lease when %s changes file bytes',
  async (operation) => {
    const path = `uploads/${tenant}/${box}/${owner}/${randomUUID()}`;
    await storage.writeFile(path, Buffer.from('original'));
    await registerSecurityFile(db, {
      storage_key: path,
      tenant_id: tenant,
      mailbox_id: box,
      user_id: owner,
      filename: 'test.txt',
      content_type: 'text/plain',
      size_bytes: 8,
      kind: 'upload',
    });
    await setStatus(path, 'clean');
    const previous = await sql<{
      generation: number;
    }>`select generation from file_security where storage_key=${path}`.execute(db);
    await sql`update file_security set lease_token=${randomUUID()}::uuid,lease_expires_at=now()+interval '1 minute' where storage_key=${path}`.execute(
      db,
    );
    if (operation === 'write') await storage.writeFile(path, Buffer.from('changed'));
    if (operation === 'append') await storage.appendFile(path, Buffer.from('more'), 8);
    if (operation === 'truncate') await storage.truncateFile(path, 3);
    if (operation === 'copy') await storage.copyFile(paths.attachment, path);
    const next = await sql<{
      status: string;
      generation: number;
      sha256: string | null;
      lease_token: string | null;
    }>`select status,generation,sha256,lease_token from file_security where storage_key=${path}`.execute(
      db,
    );
    expect(next.rows[0]).toMatchObject({
      status: 'pending',
      generation: previous.rows[0]!.generation + 1,
      sha256: null,
      lease_token: null,
    });
  },
);
