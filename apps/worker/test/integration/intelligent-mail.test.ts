import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID, randomBytes } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import pino from 'pino';
import { simpleParser } from 'mailparser';
import {
  createDb,
  createQueues,
  migrate,
  Storage,
  asJson,
  ensureLocalFolders,
  writeMailboxCredential,
  normalizeSmtpHelloName,
  type DB,
} from '@apmail/db';
import { sql, type Selectable } from 'kysely';
import { socketRedisKey, buildCalendarInvite, calendarInviteSchema } from '@apmail/shared';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { readCalendarInvite } from '../../src/lib/calendar.js';
import { buildApp } from '../../../api/src/app.js';
import { envSchema as apiEnv } from '../../../api/src/env.js';
import { hashToken } from '../../../api/src/plugins/auth.js';
import { hashPassword } from '../../../api/src/modules/auth.js';
import { envSchema } from '../../src/env.js';
import { ingestMessage } from '../../src/imap/ingest-message.js';
import { handleOutboxSend } from '../../src/handlers/outbox-send.js';
import { handleMailAction } from '../../src/handlers/mail-actions.js';
import { handleFolderAction } from '../../src/handlers/folder-actions.js';
import { handleRulesApply } from '../../src/handlers/rules-apply.js';
import { sweepOutbox } from '../../src/handlers/outbox-maintenance.js';
import { buildMdn } from '../../src/lib/mdn.js';
import { transports } from '../../src/imap/connect.js';
import { createSystemEmailHandler } from '../../src/handlers/system-email.js';
import { assertMailboxConnection } from '../../../api/src/lib/mailbox-probe.js';

const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (
  !url ||
  !new URL(url).pathname.endsWith('_test') ||
  !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)
)
  throw Error('Local test database required');
const db = createDb(url),
  tenant = randomUUID(),
  foreignTenant = randomUUID(),
  owner = randomUUID(),
  member = randomUUID(),
  foreign = randomUUID(),
  boxId = randomUUID();
const origin = 'http://localhost:5173',
  key = randomBytes(32).toString('base64'),
  storagePath = join(tmpdir(), 'apmail-intelligent-' + tenant);
const config = {
  NODE_ENV: 'development',
  DATABASE_URL: url,
  REDIS_URL: redisUrl,
  APP_URL: origin,
  SMTP_EHLO_NAME: 'app.apmail.com.br',
  SESSION_SECRET: key,
  CREDENTIALS_ENCRYPTION_KEY: key,
  STORAGE_DIR: storagePath,
  ALLOW_INSECURE_TLS_HOSTS: '127.0.0.1,localhost',
  LOG_LEVEL: 'silent',
};
const app = await buildApp(apiEnv.parse({ ...config, NODE_ENV: 'test' }));
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null }),
  queues = createQueues(redisUrl);
const r = {
  db,
  redis,
  queues: queues.queues,
  env: envSchema.parse(config),
  storage: new Storage(storagePath, db),
  log: pino({ level: 'silent' }),
  io: new Emitter(redis, { key: socketRedisKey(redisUrl) }),
};
const cookies = new Map<string, string>();
const call = (
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  body?: unknown,
  user = owner,
) =>
  app.inject({
    method,
    url: path,
    headers: {
      origin,
      cookie: cookies.get(user) ?? '',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
const greetings: string[] = [];
const deliveries: { raw: Buffer; from: string; to: string[]; hello: string }[] = [];
const connections = new Set<Socket>();
// Local SMTP fixture exercises the real Nodemailer transport without external mail.
const smtp = createServer((socket) => {
  connections.add(socket);
  socket.on('close', () => connections.delete(socket));
  socket.write('220 localhost QA SMTP\r\n');
  let buffered = '',
    hello = '',
    data = false,
    from = '',
    to: string[] = [],
    content: string[] = [];
  socket.on('data', (chunk) => {
    buffered += chunk.toString();
    let index: number;
    while ((index = buffered.indexOf('\r\n')) >= 0) {
      const line = buffered.slice(0, index);
      buffered = buffered.slice(index + 2);
      if (data) {
        if (line === '.') {
          deliveries.push({
            raw: Buffer.from(content.join('\r\n') + '\r\n'),
            from,
            to: [...to],
            hello,
          });
          data = false;
          content = [];
          socket.write('250 accepted\r\n');
        } else content.push(line.replace(/^\.\./, '.'));
        continue;
      }
      if (/^(?:EHLO|HELO) /i.test(line)) {
        hello = line.slice(5);
        greetings.push(hello);
        socket.write(
          normalizeSmtpHelloName(hello)
            ? '250-localhost\r\n250 AUTH PLAIN\r\n'
            : '550 Invalid HELO hostname\r\n',
        );
      } else if (/^AUTH /i.test(line)) socket.write('235 authenticated\r\n');
      else if (/^MAIL FROM:/i.test(line)) {
        from = line.slice(10).trim();
        to = [];
        socket.write('250 sender\r\n');
      } else if (/^RCPT TO:/i.test(line)) {
        to.push(line.slice(8).trim());
        socket.write('250 recipient\r\n');
      } else if (/^DATA$/i.test(line)) {
        data = true;
        socket.write('354 data\r\n');
      } else if (/^QUIT$/i.test(line)) {
        socket.end('221 bye\r\n');
      } else socket.write('250 ok\r\n');
    }
  });
});
let box: Selectable<DB['mailboxes']>;
let inbox: Selectable<DB['folders']>;
let uid = 0;
async function ingest(raw: Buffer) {
  const thread = await ingestMessage(
    r,
    box,
    inbox,
    { uid: ++uid, seq: uid, source: raw, size: raw.length, flags: new Set() },
    { kind: 'pop3', key: tenant + '-' + uid, historical: false },
  );
  return await db
    .selectFrom('messages')
    .selectAll()
    .where('thread_id', '=', thread)
    .orderBy('created_at', 'desc')
    .executeTakeFirstOrThrow();
}
const incoming = (address: string, request = false, id: string = randomUUID()) =>
  Buffer.from(
    `From: SMTP Name <${address}>\r\nTo: operacao@qa.example\r\nMessage-ID: <${id}@qa.example>\r\nReturn-Path: <${address}>\r\n${request ? 'Disposition-Notification-To: ' + address + '\r\n' : ''}Subject: Solicitação ${id}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nMensagem operacional.\r\n`,
  );
async function send(addresses: string[], request = false) {
  const created = await call('POST', '/api/outbox', {
    mailbox_id: boxId,
    subject: 'Envio QA ' + randomUUID(),
    body_html: '<p>Mensagem</p>',
    request_read_receipt: request,
    to_addresses: addresses.slice(0, 1).map((address) => ({ address, name: '' })),
    cc_addresses: addresses.slice(1, 2).map((address) => ({ address, name: '' })),
    bcc_addresses: addresses.slice(2).map((address) => ({ address, name: '' })),
  });
  expect(created.statusCode, created.body).toBe(201);
  const id = created.json().id;
  const submitted = await call('POST', '/api/outbox/' + id + '/submit', {});
  expect(submitted.statusCode, submitted.body).toBe(200);
  expect((await call('POST', '/api/outbox/contact-prompts/next', {})).json()).toBeNull();
  await db
    .updateTable('outbox')
    .set({ send_after: new Date(0) })
    .where('id', '=', id)
    .execute();
  await handleOutboxSend(r, id, {
    id: submitted.json().job_id,
    attemptsMade: 0,
    opts: { attempts: 1 },
  });
  return db.selectFrom('outbox').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  const port = (smtp.address() as { port: number }).port;
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Intelligent QA', slug: 'intelligent-' + tenant },
      { id: foreignTenant, name: 'Foreign', slug: 'intelligent-' + foreignTenant },
    ])
    .execute();
  for (const [id, company, role] of [
    [owner, tenant, 'owner'],
    [member, tenant, 'member'],
    [foreign, foreignTenant, 'owner'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@qa.example',
        full_name: 'QA',
        password_hash: 'fixture',
        current_tenant_id: company,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: company, user_id: id, role })
      .execute();
    await db.insertInto('user_preferences').values({ user_id: id }).execute();
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
  box = await db
    .insertInto('mailboxes')
    .values({
      id: boxId,
      tenant_id: tenant,
      name: 'QA',
      email_address: 'operacao@qa.example',
      username: 'qa',
      receiving_protocol: 'pop3',
      imap_host: '127.0.0.1',
      smtp_host: '127.0.0.1',
      smtp_port: port,
      smtp_secure: false,
      append_sent_copy: false,
      status: 'active',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  inbox = await ensureLocalFolders(db, tenant, boxId);
  await writeMailboxCredential(db, tenant, boxId, 'local-fixture', key);
  await db
    .insertInto('mailbox_members')
    .values({ tenant_id: tenant, mailbox_id: boxId, user_id: member, role: 'viewer' })
    .execute();
}, 30000);
afterAll(async () => {
  await app.close();
  await queues.close();
  await redis.quit();
  for (const socket of connections) socket.destroy();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
  await db.destroy();
});
let joao = '';
it('reconhece múltiplos e-mails e dados antigos, resolve um lote e mantém a mensagem original', async () => {
  const created = await call('POST', '/api/contacts', {
    name: 'João da Silva',
    emails: [{ email: 'joao@qa.example' }, { email: 'financeiro@qa.example' }],
  });
  expect(created.statusCode, created.body).toBe(201);
  joao = created.json().id;
  const known = await ingest(incoming('joao@qa.example')),
    unknown = await ingest(incoming('novo@qa.example'));
  const list = await call('GET', '/api/mailboxes/' + boxId + '/threads');
  expect(list.statusCode, list.body).toBe(200);
  expect(list.json().contacts['joao@qa.example'].name).toBe('João da Silva');
  expect(list.json().contacts['novo@qa.example']).toBeUndefined();
  const resolved = await call('POST', '/api/contacts/resolve', {
    emails: [
      ' JOAO@QA.EXAMPLE ',
      'financeiro@qa.example',
      'jo.ao@qa.example',
      'joao+tag@qa.example',
    ],
  });
  expect(resolved.json().contacts['financeiro@qa.example'].id).toBe(joao);
  expect(Object.keys(resolved.json().contacts)).toHaveLength(2);
  const detail = await call('GET', '/api/threads/' + known.thread_id);
  expect(detail.json().contacts['joao@qa.example'].id).toBe(joao);
  expect(detail.json().messages[0].from_name).toBe('SMTP Name');
  expect((await call('GET', '/api/threads/' + unknown.thread_id)).json().contacts).toEqual({});
});
it('cria pela mensagem, vincula sem substituir, evita conflitos e concorrência duplicada', async () => {
  const created = await call('POST', '/api/contacts/from-message', {
    name: 'Nova Pessoa',
    emails: [{ email: 'novo@qa.example' }],
    company: 'Empresa',
  });
  expect(created.statusCode, created.body).toBe(201);
  const links = await Promise.all([
    call('POST', '/api/contacts/' + joao + '/emails', { email: 'outro@qa.example' }),
    call('POST', '/api/contacts/' + joao + '/emails', { email: 'OUTRO@QA.EXAMPLE' }),
  ]);
  expect(links.map((a) => a.statusCode)).toEqual([200, 200]);
  const detail = (await call('GET', '/api/contacts/' + joao)).json();
  expect(detail.emails.map((a: { email: string }) => a.email)).toEqual(
    expect.arrayContaining(['joao@qa.example', 'financeiro@qa.example', 'outro@qa.example']),
  );
  expect(detail.emails).toHaveLength(3);
  expect(
    (
      await call('POST', '/api/contacts/' + created.json().id + '/emails', {
        email: 'outro@qa.example',
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (
      await call('POST', '/api/contacts/from-message', {
        name: 'Duplicado',
        emails: [{ email: 'outro@qa.example' }],
      })
    ).statusCode,
  ).toBe(409);
  expect(
    (await call('GET', '/api/mailboxes/' + boxId + '/threads')).json().contacts['novo@qa.example']
      .name,
  ).toBe('Nova Pessoa');
  const suggested = (
    await call('GET', '/api/mailboxes/' + boxId + '/address-suggestions?q=joao')
  ).json();
  expect(suggested.find((s: { address: string }) => s.address === 'joao@qa.example').name).toBe(
    'João da Silva',
  );
});
it('não revela contatos pessoais de outro usuário ou empresa e resolve colisões pessoais conservadoramente', async () => {
  expect(
    (await call('POST', '/api/contacts/resolve', { emails: ['joao@qa.example'] }, foreign)).json()
      .contacts,
  ).toEqual({});
  expect(
    (
      await call(
        'POST',
        '/api/contacts/' + joao + '/emails',
        { email: 'foreign@qa.example' },
        foreign,
      )
    ).statusCode,
  ).toBe(404);
  await db
    .updateTable('tenants')
    .set({ settings: asJson({ contact_mode: 'personal' }) })
    .where('id', '=', tenant)
    .execute();
  const personal = await call(
    'POST',
    '/api/contacts',
    { name: 'Privado', emails: [{ email: 'private@qa.example' }] },
    member,
  );
  expect(personal.statusCode, personal.body).toBe(201);
  expect(
    (await call('POST', '/api/contacts/resolve', { emails: ['private@qa.example'] })).json()
      .contacts,
  ).toEqual({});
  expect(
    (
      await call('POST', '/api/contacts/' + personal.json().id + '/emails', {
        email: 'hidden@qa.example',
      })
    ).statusCode,
  ).toBe(404);
  const collision = await call(
    'POST',
    '/api/contacts',
    { name: 'Meu João', emails: [{ email: 'joao@qa.example' }] },
    member,
  );
  expect(collision.statusCode, collision.body).toBe(201);
  expect(
    (await call('POST', '/api/contacts/resolve', { emails: ['joao@qa.example'] }, member)).json()
      .contacts['joao@qa.example'].name,
  ).toBe('Meu João');
  await db
    .updateTable('tenants')
    .set({ settings: asJson({}) })
    .where('id', '=', tenant)
    .execute();
});
it('envia antes da sugestão; conhecidos não abrem modal, múltiplos To/Cc/Bcc são deduplicados e não há reenvio', async () => {
  const known = await send(['joao@qa.example']);
  expect(known.status).toBe('sent');
  expect((await call('POST', '/api/outbox/contact-prompts/next', {})).json()).toBeNull();
  const unknown = await send([
    'contact1@qa.example',
    'contact2@qa.example',
    'CONTACT1@qa.example',
    'contact3@qa.example',
  ]);
  const count = deliveries.length,
    prompt = await call('POST', '/api/outbox/contact-prompts/next', {});
  expect(prompt.json().id).toBe(unknown.id);
  expect(prompt.json().addresses.map((a: { address: string }) => a.address)).toEqual([
    'contact1@qa.example',
    'contact2@qa.example',
    'contact3@qa.example',
  ]);
  expect((await call('POST', '/api/outbox/contact-prompts/next', {})).json()).toBeNull();
  expect(
    (await call('POST', '/api/contacts/' + joao + '/emails', { email: 'contact2@qa.example' }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await call('POST', '/api/contacts/from-message', {
        name: 'Contato enviado',
        emails: [{ email: 'contact1@qa.example' }],
      })
    ).statusCode,
  ).toBe(201);
  expect(deliveries).toHaveLength(count);
  expect(
    (
      await db
        .selectFrom('outbox')
        .select('status')
        .where('id', '=', unknown.id)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('sent');
}, 30000);
let outboundId = '',
  outboundHeader = '';
it('envia com e sem DNT e persiste preferência sem sobrepor a escolha manual', async () => {
  expect((await call('PUT', '/api/preferences', { request_read_receipt: true })).statusCode).toBe(
    200,
  );
  expect((await call('GET', '/api/auth/me')).json().preferences.request_read_receipt).toBe(true);
  const requested = await send(['joao@qa.example'], true);
  outboundId = requested.sent_message_id!;
  outboundHeader = requested.message_id_header!;
  expect(
    (await simpleParser(deliveries.at(-1)!.raw)).headers.has('disposition-notification-to'),
  ).toBe(true);
  await send(['joao@qa.example'], false);
  expect(
    (await simpleParser(deliveries.at(-1)!.raw)).headers.has('disposition-notification-to'),
  ).toBe(false);
  expect((await call('GET', '/api/auth/me')).json().preferences.request_read_receipt).toBe(true);
}, 30000);
it('pedido recebido somente envia por consentimento explícito, em MIME MDN; confirma uma vez entre usuários e cópias', async () => {
  const message = await ingest(incoming('reader@qa.example', true));
  expect(message.mdn_request).not.toBeNull();
  const before = deliveries.length;
  await call('GET', '/api/threads/' + message.thread_id);
  expect(deliveries).toHaveLength(before);
  expect(
    (
      await call(
        'POST',
        '/api/messages/' + message.id + '/read-receipt',
        { decision: 'confirm' },
        foreign,
      )
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await call(
        'POST',
        '/api/messages/' + message.id + '/read-receipt',
        { decision: 'confirm' },
        member,
      )
    ).statusCode,
  ).toBe(403);
  const confirm = await call('POST', '/api/messages/' + message.id + '/read-receipt', {
    decision: 'confirm',
  });
  expect(confirm.statusCode, confirm.body).toBe(200);
  const repeated = await call('POST', '/api/messages/' + message.id + '/read-receipt', {
    decision: 'confirm',
  });
  expect(repeated.json().outbox_id).toBe(confirm.json().outbox_id);
  const row = await db
    .selectFrom('outbox')
    .selectAll()
    .where('id', '=', confirm.json().outbox_id)
    .executeTakeFirstOrThrow();
  await handleOutboxSend(r, row.id, { id: row.job_id!, attemptsMade: 0, opts: { attempts: 1 } });
  await handleOutboxSend(r, row.id, { id: row.job_id!, attemptsMade: 0, opts: { attempts: 1 } });
  expect(deliveries).toHaveLength(before + 1);
  const receipt = deliveries.at(-1)!;
  expect(receipt.from).toBe('<>');
  expect(receipt.to).toEqual(['<reader@qa.example>']);
  const operational = await db
    .selectFrom('threads')
    .select(['queue_status', 'first_response_at'])
    .where('id', '=', message.thread_id)
    .executeTakeFirstOrThrow();
  expect(operational.queue_status).toBe('to_reply');
  expect(operational.first_response_at).toBeNull();
  expect((await simpleParser(receipt.raw)).attachments[0]!.contentType).toBe(
    'message/disposition-notification',
  );
  expect((await call('POST', '/api/outbox/' + row.id + '/retry', {})).statusCode).toBe(404);
  const duplicate = await ingest(
    incoming('reader@qa.example', true, message.message_id_header.slice(1, -12)),
  );
  const again = await call('POST', '/api/messages/' + duplicate.id + '/read-receipt', {
    decision: 'confirm',
  });
  expect(again.json().outbox_id).toBe(row.id);
}, 30000);
it('recusa é persistente, não envia nem pergunta novamente; pedidos inválidos não são respondidos', async () => {
  const message = await ingest(incoming('refuse@qa.example', true));
  const before = deliveries.length;
  const refused = await call('POST', '/api/messages/' + message.id + '/read-receipt', {
    decision: 'decline',
  });
  expect(refused.json().outbox_id).toBeNull();
  const repeated = await call('POST', '/api/messages/' + message.id + '/read-receipt', {
    decision: 'confirm',
  });
  expect(repeated.json().decision).toBe('decline');
  expect(deliveries).toHaveLength(before);
  expect(
    (await call('GET', '/api/threads/' + message.thread_id))
      .json()
      .messages.find((m: { id: string }) => m.id === message.id).mdn_decision.decision,
  ).toBe('decline');
  const invalid = await ingest(
    Buffer.from(
      incoming('invalid@qa.example', true)
        .toString()
        .replace(
          'Disposition-Notification-To: invalid@qa.example',
          'Disposition-Notification-To: invalid address',
        ),
    ),
  );
  expect(invalid.mdn_request).toBeNull();
  expect(
    (await call('POST', '/api/messages/' + invalid.id + '/read-receipt', { decision: 'confirm' }))
      .statusCode,
  ).toBe(409);
});
it('processa MDN de Message-ID e destinatário corretos com idempotência; não interpreta outro destinatário ou disposição como leitura', async () => {
  const make = (recipient: string, disposition = 'displayed') =>
    Buffer.from(
      buildMdn({
        to: box.email_address,
        recipient,
        original_message_id: outboundHeader,
        return_path_matches: true,
      })
        .raw.toString()
        .replace('; displayed', '; ' + disposition),
    );
  await ingest(make('not-sent@qa.example'));
  expect(
    await db
      .selectFrom('mdn_receipts')
      .selectAll()
      .where('original_message_id', '=', outboundId)
      .execute(),
  ).toHaveLength(0);
  await ingest(make('joao@qa.example', 'processed'));
  expect(
    await db
      .selectFrom('mdn_receipts')
      .selectAll()
      .where('original_message_id', '=', outboundId)
      .where('disposition', '=', 'displayed')
      .execute(),
  ).toHaveLength(0);
  const raw = make('joao@qa.example');
  await ingest(raw);
  await ingest(raw);
  const records = await db
    .selectFrom('mdn_receipts')
    .selectAll()
    .where('original_message_id', '=', outboundId)
    .where('disposition', '=', 'displayed')
    .execute();
  expect(records).toHaveLength(1);
  expect(records[0]!.received_at).toBeInstanceOf(Date);
  const original = await db
    .selectFrom('messages')
    .select('thread_id')
    .where('id', '=', outboundId)
    .executeTakeFirstOrThrow();
  const detail = await call('GET', '/api/threads/' + original.thread_id);
  expect(
    detail
      .json()
      .messages.find((m: { id: string }) => m.id === outboundId)
      .read_receipts.some((v: { disposition: string }) => v.disposition === 'displayed'),
  ).toBe(true);
});
it('recuperação nunca repete uma MDN cujo resultado SMTP ficou incerto', async () => {
  const message = await ingest(incoming('uncertain@qa.example', true));
  const confirmation = await call('POST', '/api/messages/' + message.id + '/read-receipt', {
    decision: 'confirm',
  });
  const id = confirmation.json().outbox_id;
  await db.updateTable('outbox').set({ status: 'sending' }).where('id', '=', id).execute();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(Date.now() + 700000));
  try {
    await sweepOutbox(r);
  } finally {
    vi.useRealTimers();
  }
  expect(
    (await db.selectFrom('outbox').select('status').where('id', '=', id).executeTakeFirstOrThrow())
      .status,
  ).toBe('failed');
});
it('preferência permanece depois de logout e um novo login autenticado', async () => {
  const password = 'Local-QA-2026!';
  await db
    .updateTable('users')
    .set({ password_hash: await hashPassword(password) })
    .where('id', '=', owner)
    .execute();
  expect((await call('POST', '/api/auth/logout', {})).statusCode).toBe(200);
  expect((await call('GET', '/api/auth/me')).statusCode).toBe(401);
  const login = await call('POST', '/api/auth/login', { email: owner + '@qa.example', password });
  expect(login.statusCode, login.body).toBe(200);
  const cookie = login.cookies.find((item) => item.name === 'apmail_session')!;
  cookies.set(owner, 'apmail_session=' + encodeURIComponent(cookie.value));
  expect((await call('GET', '/api/auth/me')).json().preferences.request_read_receipt).toBe(true);
});
it('envia convites MIME reais, aplica RSVP recebido e envia resposta explícita por SMTP local', async () => {
  const signature = await db
    .insertInto('signatures')
    .values({
      tenant_id: tenant,
      user_id: owner,
      name: 'Assinatura de convites',
      body_html: '<p>Equipe APMail · Projetos</p>',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const preferences = await call('PUT', '/api/calendar/email-preferences', {
    message_template: 'Olá!\nVocê recebeu um convite automático para {{titulo}}.',
    mailbox_id: boxId,
    signature_mode: 'selected',
    signature_id: signature.id,
  });
  expect(preferences.statusCode, preferences.body).toBe(200);
  const calendars = (await call('GET', '/api/calendars')).json();
  const created = await call('POST', '/api/calendar/events', {
    calendar_id: calendars[0].id,
    mailbox_id: boxId,
    title: 'Reunião interoperável QA',
    meeting_url: 'https://meet.google.com/abc-defg-hij',
    description_html: '<p>Pauta de <strong>planejamento</strong>.</p>',
    starts_at: '2030-10-16T17:00:00.000Z',
    ends_at: '2030-10-16T18:00:00.000Z',
    attendees: [{ address: 'guest@qa.example', name: 'Convidado' }],
    timezone: 'America/Sao_Paulo',
  });
  expect(created.statusCode, created.body).toBe(200);
  const event = created.json();
  const deliver = async (uid: string, method: string) => {
    const outbox = await db
      .selectFrom('outbox')
      .selectAll()
      .where('tenant_id', '=', tenant)
      .where(sql<string>`calendar_payload->>'uid'`, '=', uid)
      .where(sql<string>`calendar_payload->>'method'`, '=', method)
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow();
    await handleOutboxSend(r, outbox.id, {
      id: outbox.job_id!,
      attemptsMade: 0,
      opts: { attempts: 1 },
    });
    expect(
      (
        await db
          .selectFrom('outbox')
          .select('status')
          .where('id', '=', outbox.id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('sent');
    const mime = await simpleParser(deliveries.at(-1)!.raw);
    expect(deliveries.at(-1)!.raw.toString()).toMatch(
      new RegExp('text/calendar;[^\\r]*method=' + method, 'i'),
    );
    return mime;
  };
  const request = readCalendarInvite(await deliver(event.uid, 'REQUEST'), box.email_address, [
    'guest@qa.example',
  ]);
  expect(request).toMatchObject({
    method: 'REQUEST',
    uid: event.uid,
    organizer: box.email_address,
    meeting_url: 'https://meet.google.com/abc-defg-hij',
  });
  expect(deliveries.at(-1)!.raw.toString()).toContain('text/calendar');
  const invitationMail = await simpleParser(deliveries.at(-1)!.raw);
  expect(invitationMail.html).toContain('Entrar na reunião');
  expect(invitationMail.html).toContain('planejamento');
  expect(invitationMail.html).toContain('convite automático para Reunião interoperável QA');
  expect(invitationMail.html).toContain('Equipe APMail');
  const reply = calendarInviteSchema.parse({
    ...request!,
    method: 'REPLY',
    attendees: [{ address: 'guest@qa.example', name: 'Convidado', status: 'ACCEPTED' }],
  });
  await ingest(
    await new MailComposer({
      from: 'guest@qa.example',
      to: box.email_address,
      subject: 'Aceito',
      icalEvent: { method: 'REPLY', content: buildCalendarInvite(reply) },
    })
      .compile()
      .build(),
  );
  expect((await call('GET', '/api/calendar/events/' + event.id)).json().attendees[0].status).toBe(
    'ACCEPTED',
  );
  const external = calendarInviteSchema.parse({
    ...request!,
    uid: randomUUID() + '@qa.example',
    organizer: 'guest@qa.example',
    attendees: [{ address: box.email_address, name: 'Operação' }],
  });
  const incoming = await ingest(
    await new MailComposer({
      from: external.organizer,
      to: box.email_address,
      subject: 'Reunião externa QA',
      icalEvent: { method: 'REQUEST', content: buildCalendarInvite(external) },
    })
      .compile()
      .build(),
  );
  expect(incoming.calendar_invite).not.toBeNull();
  const accepted = await call('POST', '/api/messages/' + incoming.id + '/calendar/respond', {
    status: 'ACCEPTED',
  });
  expect(accepted.statusCode, accepted.body).toBe(200);
  const received = readCalendarInvite(await deliver(external.uid, 'REPLY'), box.email_address, [
    external.organizer,
  ]);
  expect(received).toMatchObject({
    method: 'REPLY',
    uid: external.uid,
    attendees: [{ address: box.email_address, status: 'ACCEPTED' }],
  });
});

it('usa EHLO público em respostas externas, SMTP global e teste de conexão, sem depender do hostname do contêiner', async () => {
  // Every preceding queued message, MDN and ICS used this same validated identity.
  expect(deliveries.length).toBeGreaterThan(5);
  expect(deliveries.every((delivery) => delivery.hello === 'app.apmail.com.br')).toBe(true);
  const original = await ingest(incoming('destinatario@gmail.com'));
  const draft = await call('POST', '/api/outbox', {
    mailbox_id: boxId,
    kind: 'reply',
    thread_id: original.thread_id,
    reply_to_message_id: original.id,
    subject: 'Re: ' + original.subject,
    body_html: '<p>Resposta para domínio externo.</p>',
    to_addresses: [{ address: 'destinatario@gmail.com' }],
  });
  expect(draft.statusCode, draft.body).toBe(201);
  const submitted = await call('POST', '/api/outbox/' + draft.json().id + '/submit', {});
  expect(submitted.statusCode, submitted.body).toBe(200);
  await db
    .updateTable('outbox')
    .set({ send_after: new Date(0) })
    .where('id', '=', draft.json().id)
    .execute();
  await handleOutboxSend(r, draft.json().id, {
    id: submitted.json().job_id,
    attemptsMade: 0,
    opts: { attempts: 1 },
  });
  const delivered = deliveries.at(-1)!;
  expect(delivered.hello).toBe('app.apmail.com.br');
  expect(delivered.to).toContain('<destinatario@gmail.com>');
  expect((await simpleParser(delivered.raw)).inReplyTo).toBe(original.message_id_header);
  const replyAudit = await db
    .selectFrom('audit_logs')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .where('event_key', '=', draft.json().id + ':sent')
    .executeTakeFirstOrThrow();
  expect(replyAudit.action).toBe('message.replied');
  expect(replyAudit.actor_id).toBe(owner);
  expect(replyAudit.message_content).toContain('Resposta para domínio externo.');
  const audited = await call('GET', '/api/audit-logs/' + replyAudit.id);
  expect(audited.statusCode, audited.body).toBe(200);
  expect(audited.json().message_content).toContain('Resposta para domínio externo.');
  expect(
    (
      await db
        .selectFrom('outbox')
        .select('status')
        .where('id', '=', draft.json().id)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('sent');

  const automatic = envSchema.parse({
    ...config,
    SMTP_EHLO_NAME: '',
    APP_URL: 'https://app.apmail.com.br:75',
  });
  const overridden = await transports(db, box, {
    ...automatic,
    SMTP_EHLO_NAME: 'smtp.aptechinfo.com.br',
  });
  try {
    await overridden.smtp.verify();
    expect(greetings.at(-1)).toBe('smtp.aptechinfo.com.br');
  } finally {
    await overridden.close();
  }
  const global = createSystemEmailHandler({
    ...automatic,
    SYSTEM_SMTP_HOST: '127.0.0.1',
    SYSTEM_SMTP_PORT: box.smtp_port,
    SYSTEM_MAIL_FROM: box.email_address,
  });
  await global('password-changed', { to: 'destinatario@gmail.com', data: {} });
  expect(deliveries.at(-1)!.hello).toBe('app.apmail.com.br');
  expect((await simpleParser(deliveries.at(-1)!.raw)).subject).toContain('Sua senha foi alterada');

  const popSockets = new Set<Socket>();
  const pop = createServer((socket) => {
    popSockets.add(socket);
    socket.on('close', () => popSockets.delete(socket));
    socket.write('+OK QA POP3\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let index: number;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const command = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (/^(UIDL|LIST)$/.test(command)) socket.write('+OK\r\n.\r\n');
        else if (command === 'QUIT') socket.end('+OK bye\r\n');
        else socket.write('+OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => pop.listen(0, '127.0.0.1', resolve));
  try {
    const before = greetings.length;
    const result = await assertMailboxConnection(
      apiEnv.parse({ ...config, SMTP_EHLO_NAME: '', APP_URL: automatic.APP_URL }),
      {
        receiving_protocol: 'pop3',
        username: 'qa',
        password: 'local-fixture',
        imap_host: '127.0.0.1',
        imap_port: (pop.address() as { port: number }).port,
        imap_secure: false,
        smtp_host: '127.0.0.1',
        smtp_port: box.smtp_port,
        smtp_secure: false,
      },
    );
    expect(result.smtp).toBe(true);
    expect(result.pop3).toBe(true);
    expect(greetings.length).toBeGreaterThan(before);
    expect(greetings.at(-1)).toBe('app.apmail.com.br');
  } finally {
    for (const socket of popSockets) socket.destroy();
    await new Promise<void>((resolve) => pop.close(() => resolve()));
  }
}, 30000);

it('audita solicitação e conclusão da exclusão real de uma mensagem, com idempotência do job', async () => {
  // The previous SMTP scenario intentionally leaves a post-send contact suggestion pending.
  await db
    .updateTable('outbox')
    .set({ contact_prompt_handled: true })
    .where('tenant_id', '=', tenant)
    .execute();
  const row = await send(['delete-audit@qa.example']);
  const action = await call('POST', '/api/mailboxes/' + boxId + '/messages/actions', {
    type: 'delete',
    message_ids: [row.sent_message_id],
  });
  expect(action.statusCode, action.body).toBe(202);
  const actionId = action.json().action_id as string;
  await handleMailAction(r, actionId, 'qa-' + actionId, true);
  await handleMailAction(r, actionId, 'qa-' + actionId, true);
  const events = await db
    .selectFrom('audit_logs')
    .select(['action', 'actor_id', 'message_content'])
    .where('tenant_id', '=', tenant)
    .where('entity_id', '=', row.sent_message_id!)
    .where('action', 'in', ['message.delete_requested', 'message.deleted'])
    .execute();
  expect(events).toHaveLength(2);
  expect(events.map((e) => e.action).sort()).toEqual([
    'message.delete_requested',
    'message.deleted',
  ]);
  expect(events.every((e) => e.actor_id === owner && e.message_content?.includes('Mensagem'))).toBe(
    true,
  );
});

it('revalidates personal send permission before delivering a queued email', async () => {
  await db
    .updateTable('mailbox_members')
    .set({ role: 'editor' })
    .where('tenant_id', '=', tenant)
    .where('mailbox_id', '=', boxId)
    .where('user_id', '=', member)
    .execute();
  const draft = await call(
    'POST',
    '/api/outbox',
    {
      mailbox_id: boxId,
      subject: 'Envio revogado',
      to_addresses: [{ address: 'revoked@qa.example', name: '' }],
      body_html: '<p>Não transmitir</p>',
    },
    member,
  );
  expect(draft.statusCode, draft.body).toBe(201);
  const id = draft.json().id,
    submitted = await call('POST', '/api/outbox/' + id + '/submit', {}, member);
  expect(submitted.statusCode, submitted.body).toBe(200);
  const delivered = deliveries.length;
  await db
    .updateTable('outbox')
    .set({ send_after: new Date(0) })
    .where('id', '=', id)
    .execute();
  await db
    .updateTable('tenant_members')
    .set({ custom_permissions: ['mail'] })
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', member)
    .execute();
  try {
    await expect(
      handleOutboxSend(r, id, {
        id: submitted.json().job_id,
        attemptsMade: 0,
        opts: { attempts: 1 },
      }),
    ).rejects.toThrow();
    expect(deliveries).toHaveLength(delivered);
    expect(
      (
        await db
          .selectFrom('outbox')
          .select('status')
          .where('id', '=', id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('failed');
  } finally {
    await db
      .updateTable('tenant_members')
      .set({ custom_permissions: null })
      .where('tenant_id', '=', tenant)
      .where('user_id', '=', member)
      .execute();
    await db
      .updateTable('mailbox_members')
      .set({ role: 'viewer' })
      .where('tenant_id', '=', tenant)
      .where('mailbox_id', '=', boxId)
      .where('user_id', '=', member)
      .execute();
  }
});
it('does not execute an existing mailbox rule after flag permission is revoked', async () => {
  const thread = await db
    .insertInto('threads')
    .values({ tenant_id: tenant, mailbox_id: boxId, subject: 'Rule permission regression' })
    .returning('id')
    .executeTakeFirstOrThrow();
  const msg = await db
    .insertInto('messages')
    .values({
      tenant_id: tenant,
      mailbox_id: boxId,
      thread_id: thread.id,
      folder_id: inbox.id,
      direction: 'inbound',
      subject: 'Rule permission regression',
      from_address: 'rule-permission@qa.example',
      message_at: new Date(),
      message_id_header: '<' + randomUUID() + '@qa.example>',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const rule = await db
    .insertInto('mail_rules')
    .values({
      tenant_id: tenant,
      mailbox_id: boxId,
      created_by: member,
      scope: 'mailbox',
      name: 'Restricted flag',
      is_active: true,
      priority: 1,
      match_mode: 'all',
      conditions: asJson([
        { field: 'from', operator: 'equals', value: 'rule-permission@qa.example' },
      ]),
      actions: asJson([{ type: 'mark_flagged' }]),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .updateTable('mailbox_members')
    .set({ role: 'mailbox_admin' })
    .where('tenant_id', '=', tenant)
    .where('mailbox_id', '=', boxId)
    .where('user_id', '=', member)
    .execute();
  await db
    .updateTable('tenant_members')
    .set({ custom_permissions: ['mail', 'rules'] })
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', member)
    .execute();
  try {
    await handleRulesApply(r, rule.id, null, 'qa-rule-permission-' + rule.id);
    expect(
      (
        await db
          .selectFrom('messages')
          .select('is_flagged')
          .where('id', '=', msg.id)
          .executeTakeFirstOrThrow()
      ).is_flagged,
    ).toBe(false);
  } finally {
    await db
      .updateTable('tenant_members')
      .set({ custom_permissions: null })
      .where('tenant_id', '=', tenant)
      .where('user_id', '=', member)
      .execute();
    await db
      .updateTable('mailbox_members')
      .set({ role: 'viewer' })
      .where('tenant_id', '=', tenant)
      .where('mailbox_id', '=', boxId)
      .where('user_id', '=', member)
      .execute();
  }
});
it('revalidates permissions before a queued folder action', async () => {
  const folder = await db
    .selectFrom('folders')
    .selectAll()
    .where('mailbox_id', '=', boxId)
    .where('special_use', '=', 'inbox')
    .executeTakeFirstOrThrow();
  const action = await db
    .insertInto('mail_actions')
    .values({
      tenant_id: tenant,
      mailbox_id: boxId,
      requested_by: member,
      type: 'create_folder',
      payload: asJson({
        name: 'Blocked child',
        imap_path: 'INBOX/Blocked-' + randomUUID(),
        parent_id: folder.id,
      }),
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await db
    .updateTable('tenant_members')
    .set({ custom_permissions: ['mail'] })
    .where('tenant_id', '=', tenant)
    .where('user_id', '=', member)
    .execute();
  try {
    await expect(handleFolderAction(r, action, 'qa-folder-' + action.id, true)).rejects.toThrow();
    expect(
      (
        await db
          .selectFrom('mail_actions')
          .select('status')
          .where('id', '=', action.id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('failed');
    expect(
      await db
        .selectFrom('folders')
        .select('id')
        .where('mailbox_id', '=', boxId)
        .where('name', '=', 'Blocked child')
        .execute(),
    ).toHaveLength(0);
  } finally {
    await db
      .updateTable('tenant_members')
      .set({ custom_permissions: null })
      .where('tenant_id', '=', tenant)
      .where('user_id', '=', member)
      .execute();
  }
});
it('preserva fonte e assinatura editada no rascunho, no MIME e na cópia enviada sem alterar o modelo', async () => {
  const signature = await db
    .insertInto('signatures')
    .values({
      tenant_id: tenant,
      user_id: owner,
      name: 'Assinatura editável QA',
      body_html: '<p>Modelo original</p>',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  const html = `<p><strong><em><u><s><span style="font-family: Georgia, serif; font-size: 20px; color: #123456">Texto com fonte pessoal</span></s></u></em></strong></p><div data-apmail-signature="${signature.id}"><p>Telefone corrigido somente neste envio</p></div>`;
  const draft = await call('POST', '/api/outbox', {
    mailbox_id: boxId,
    subject: 'Assinatura editável',
    to_addresses: [{ address: 'signature@qa.example', name: '' }],
    body_html: html,
    signature_id: signature.id,
  });
  expect(draft.statusCode, draft.body).toBe(201);
  const id = draft.json().id;
  const reopened = await call('GET', '/api/outbox/' + id);
  expect(reopened.json().body_html).toContain('Telefone corrigido');
  expect(reopened.json().body_html).not.toContain('Modelo original');
  const submitted = await call('POST', '/api/outbox/' + id + '/submit', {});
  expect(submitted.statusCode, submitted.body).toBe(200);
  await db
    .updateTable('outbox')
    .set({ send_after: new Date(0) })
    .where('id', '=', id)
    .execute();
  await handleOutboxSend(r, id, {
    id: submitted.json().job_id,
    attemptsMade: 0,
    opts: { attempts: 1 },
  });
  const row = await db
    .selectFrom('outbox')
    .selectAll()
    .where('id', '=', id)
    .executeTakeFirstOrThrow();
  expect(row.status).toBe('sent');
  const mime = await simpleParser(deliveries.at(-1)!.raw);
  const copy = await db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', row.sent_message_id!)
    .executeTakeFirstOrThrow();
  expect(mime.html).toContain('font-family:Georgia, serif');
  expect(mime.html).toContain('font-size:20px');
  expect(mime.html).toContain('color:#123456');
  expect(mime.html).toContain('Telefone corrigido');
  expect(mime.html).not.toContain('Modelo original');
  expect(copy.body_html).toBe(mime.html);
  expect(
    (
      await db
        .selectFrom('signatures')
        .select('body_html')
        .where('id', '=', signature.id)
        .executeTakeFirstOrThrow()
    ).body_html,
  ).toBe('<p>Modelo original</p>');
  const cleared = await call('POST', '/api/outbox', {
    mailbox_id: boxId,
    subject: 'Sem texto de assinatura',
    body_html: `<p>Texto</p><div data-apmail-signature="${signature.id}"></div>`,
    signature_id: signature.id,
  });
  expect(cleared.statusCode, cleared.body).toBe(201);
  expect(cleared.json().body_html).not.toContain('Modelo original');
});
