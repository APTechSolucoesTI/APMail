import { beforeAll, afterAll, it, expect } from 'vitest';
import { socketRedisKey } from '@apmail/shared';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { Worker } from 'bullmq';
import { handleOutboxSend } from '../../src/handlers/outbox-send.js';
import { sweepOutbox } from '../../src/handlers/outbox-maintenance.js';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDb,
  createQueues,
  migrate,
  Storage,
  writeMailboxCredential,
  touchThreads,
} from '@apmail/db';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import pino from 'pino';
import { envSchema } from '../../src/env.js';
import { transports } from '../../src/imap/connect.js';
import {
  handleMailboxConnection,
  markMailboxError,
} from '../../src/handlers/mailbox-connection.js';
import { handleMailboxSync } from '../../src/handlers/mailbox-sync.js';
import { handleMailAction } from '../../src/handlers/mail-actions.js';
import { ensureSchedulers } from '../../src/handlers/ensure-schedulers.js';
import { withMailboxLock } from '../../src/lib/mailbox-lock.js';
import { buildApp } from '../../../api/src/app.js';
import { envSchema as apiEnvSchema } from '../../../api/src/env.js';
import { hashToken } from '../../../api/src/plugins/auth.js';
const databaseUrl = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!databaseUrl || !new URL(databaseUrl).pathname.endsWith('_test'))
  throw new Error('Banco de teste exclusivo obrigatório.');
const suffix = randomUUID(),
  tenantId = randomUUID(),
  boxId = randomUUID(),
  owner = randomUUID(),
  viewer = randomUUID(),
  editor = randomUUID();
const mailHost = process.env.TEST_MAIL_HOST ?? 'localhost';
const imapPort = Number(process.env.TEST_IMAP_PORT ?? 3143),
  smtpPort = Number(process.env.TEST_SMTP_PORT ?? 3025);
const origin = 'http://localhost:5173',
  key = randomBytes(32).toString('base64');
const env = envSchema.parse({
  NODE_ENV: 'development',
  DATABASE_URL: databaseUrl,
  REDIS_URL: redisUrl,
  APP_URL: origin,
  SESSION_SECRET: key,
  CREDENTIALS_ENCRYPTION_KEY: key,
  ALLOW_INSECURE_TLS_HOSTS: 'localhost,127.0.0.1,' + mailHost,
  STORAGE_DIR: join(tmpdir(), 'apmail-test-' + suffix),
});
const db = createDb(databaseUrl),
  queues = createQueues(redisUrl),
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const r = {
  db,
  queues: queues.queues,
  redis,
  io: new Emitter(redis, { key: socketRedisKey(redisUrl) }),
  env,
  storage: new Storage(join(tmpdir(), 'apmail-test-' + suffix)),
  log: pino({ level: 'silent' }),
};
const app = await buildApp(apiEnvSchema.parse({ ...env, NODE_ENV: 'test' }));
const cookies = new Map<string, string>();
const sourcePath = 'QA-' + suffix,
  targetPath = sourcePath + '-Destino',
  resetPath = sourcePath + '-UID';
let sourceId = '',
  targetId = '',
  trashId = '';
async function client() {
  const box = await db
    .selectFrom('mailboxes')
    .selectAll()
    .where('id', '=', boxId)
    .executeTakeFirstOrThrow();
  return transports(db, box, env);
}
const api = (
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  url: string,
  user = owner,
  payload?: unknown,
) =>
  app.inject({
    method,
    url,
    headers: {
      cookie: cookies.get(user)!,
      origin,
      ...(payload ? { 'content-type': 'application/json' } : {}),
    },
    ...(payload ? { payload: JSON.stringify(payload) } : {}),
  });
async function sync() {
  const result = await handleMailboxSync(r, boxId, 'qa-' + randomUUID());
  expect(result).not.toBe('skipped');
}
beforeAll(async () => {
  await migrate(databaseUrl);
  await app.ready();
  await db
    .insertInto('tenants')
    .values({ id: tenantId, name: 'Sync QA', slug: 'sync-' + suffix })
    .execute();
  for (const [id, role] of [
    [owner, 'owner'],
    [viewer, 'member'],
    [editor, 'member'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id,
        email: id + '@apmail.local',
        full_name: 'Usuário QA',
        password_hash: 'not-used-by-session-test',
        current_tenant_id: tenantId,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: tenantId, user_id: id, role })
      .execute();
    const token = randomBytes(32).toString('base64url');
    await db
      .insertInto('sessions')
      .values({
        token_hash: hashToken(token),
        user_id: id,
        expires_at: new Date(Date.now() + 3600000),
      })
      .execute();
    cookies.set(id, 'apmail_session=' + encodeURIComponent(app.signCookie(token)));
  }
  await db
    .insertInto('mailboxes')
    .values({
      id: boxId,
      tenant_id: tenantId,
      name: 'Caixa Sync QA',
      email_address: 'comercial@apmail.local',
      imap_host: mailHost,
      imap_port: imapPort,
      imap_secure: false,
      smtp_host: mailHost,
      smtp_port: smtpPort,
      smtp_secure: false,
      username: 'comercial@apmail.local',
      created_by: owner,
      sync_since: new Date('2020-01-01'),
    })
    .execute();
  await writeMailboxCredential(db, tenantId, boxId, 'Senha123', key);
  for (const [id, role] of [
    [viewer, 'viewer'],
    [editor, 'editor'],
  ] as const)
    await db
      .insertInto('mailbox_members')
      .values({ tenant_id: tenantId, mailbox_id: boxId, user_id: id, role })
      .execute();
  await handleMailboxConnection(r, boxId);
  const t = await client();
  try {
    await t.imap.connect();
    for (const path of [sourcePath, targetPath, resetPath]) await t.imap.mailboxCreate(path);
    if (!(await t.imap.list()).some((f) => f.path === 'Trash')) await t.imap.mailboxCreate('Trash');
    if (!(await t.imap.list()).some((f) => f.path === 'Sent')) await t.imap.mailboxCreate('Sent');
    const raw = (subject: string, id: string, reply?: string) =>
      `From: Cliente <cliente@cliente.local>\r\nTo: comercial@apmail.local\r\nSubject: ${subject}\r\nMessage-ID: <${id}-${suffix}@cliente.local>\r\n${reply ? `In-Reply-To: <${reply}-${suffix}@cliente.local>\r\nReferences: <${reply}-${suffix}@cliente.local>\r\n` : ''}Date: ${new Date().toUTCString()}\r\nContent-Type: text/plain; charset=utf-8\r\nX-APMail-QA: ${suffix}\r\n\r\nMensagem de teste.\r\n`;
    await t.imap.append(sourcePath, raw('Pedido ' + suffix, 'one'));
    await t.imap.append(sourcePath, raw('Assunto modificado', 'two', 'one'));
    await t.imap.append(sourcePath, raw('RES: ENC: Re: Pedido ' + suffix, 'three'));
    const html = await readFile(new URL('../fixtures/unsafe-html.eml', import.meta.url), 'utf8');
    await t.imap.append(
      sourcePath,
      html
        .replace('fixture-html@cliente.local', 'html-' + suffix + '@cliente.local')
        .replace('HTML e privacidade', 'HTML ' + suffix)
        .replace('\n\n', '\nX-APMail-QA: ' + suffix + '\n\n'),
    );
    for (const name of ['newsletter', 'attachments']) {
      const fixture = await readFile(
        new URL('../fixtures/' + name + '.eml', import.meta.url),
        'utf8',
      );
      await t.imap.append(
        sourcePath,
        fixture
          .replace('fixture-' + name + '@cliente.local', name + '-' + suffix + '@cliente.local')
          .replace('\n\n', '\nX-APMail-QA: ' + suffix + '\n\n'),
      );
    }
    await t.imap.append(resetPath, raw('UIDValidity ' + suffix, 'uid'));
  } finally {
    await t.close();
  }
  await sync();
  const folders = await db
    .selectFrom('folders')
    .select(['id', 'imap_path'])
    .where('mailbox_id', '=', boxId)
    .where('deleted_at', 'is', null)
    .execute();
  sourceId = folders.find((f) => f.imap_path === sourcePath)!.id;
  targetId = folders.find((f) => f.imap_path === targetPath)!.id;
  trashId = folders.find((f) => f.imap_path === 'Trash')!.id;
}, 60000);
afterAll(async () => {
  const t = await client().catch(() => null);
  if (t)
    try {
      await t.imap.connect();
      for (const f of await t.imap.list()) {
        if ([sourcePath, targetPath, resetPath].includes(f.path)) {
          await t.imap.mailboxDelete(f.path);
          continue;
        }
        if (f.flags.has('\\Noselect')) continue;
        const lock = await t.imap.getMailboxLock(f.path);
        try {
          const uids = await t.imap.search({ header: { 'X-APMail-QA': suffix } }, { uid: true });
          if (Array.isArray(uids) && uids.length) await t.imap.messageDelete(uids, { uid: true });
          for (const id of outboxIds) {
            const sent = await t.imap.search(
              { header: { 'X-APMail-Outbox-Id': id } },
              { uid: true },
            );
            if (Array.isArray(sent) && sent.length) await t.imap.messageDelete(sent, { uid: true });
          }
        } finally {
          lock.release();
        }
      }
    } finally {
      await t.close();
    }
  await r.queues['mailbox-sync'].removeJobScheduler('sync:' + boxId);
  await app.close();
  await queues.close();
  await redis.quit();
  await db.destroy();
}, 30000);
it('conecta IMAP e SMTP, registra scheduler e agrupa referências e assunto no mesmo lote', async () => {
  expect(
    (
      await db
        .selectFrom('mailboxes')
        .select('status')
        .where('id', '=', boxId)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('active');
  expect(await r.queues['mailbox-sync'].getJobScheduler('sync:' + boxId)).toBeTruthy();
  const messages = await db
    .selectFrom('messages')
    .select(['thread_id', 'body_html'])
    .where('folder_id', '=', sourceId)
    .where('deleted_at', 'is', null)
    .execute();
  expect(messages).toHaveLength(6);
  expect(new Set(messages.slice(0, 3).map((m) => m.thread_id)).size).toBeLessThanOrEqual(2);
  const chain = await db
    .selectFrom('messages')
    .select('thread_id')
    .where('mailbox_id', '=', boxId)
    .where(
      'message_id_header',
      'in',
      ['one', 'two', 'three'].map((s) => `<${s}-${suffix}@cliente.local>`),
    )
    .execute();
  expect(new Set(chain.map((m) => m.thread_id)).size).toBe(1);
  const html = messages.map((m) => m.body_html).find((h) => h?.includes('data-apmail-src'))!;
  expect(html).not.toMatch(/<script|onerror|javascript:/);
  expect(html).toContain('data-apmail-cid');
});
it('estado de leitura é individual e viewer/editor não organizam mensagens', async () => {
  const list = await api('GET', `/api/mailboxes/${boxId}/threads?folder_id=${sourceId}`, viewer);
  expect(list.statusCode).toBe(200);
  const thread = list.json().items[0];
  expect(thread.is_unread).toBe(true);
  expect((await api('POST', `/api/threads/${thread.id}/read`, editor)).statusCode).toBe(200);
  const read = await api('GET', `/api/mailboxes/${boxId}/threads?folder_id=${sourceId}`, editor);
  expect(read.json().items.find((i: { id: string }) => i.id === thread.id).is_unread).toBe(false);
  const unread = await api('GET', `/api/mailboxes/${boxId}/threads?folder_id=${sourceId}`, viewer);
  expect(unread.json().items.find((i: { id: string }) => i.id === thread.id).is_unread).toBe(true);
  for (const user of [viewer, editor])
    expect(
      (
        await api('POST', `/api/mailboxes/${boxId}/messages/actions`, user, {
          type: 'delete',
          thread_ids: [thread.id],
        })
      ).statusCode,
    ).toBe(403);
});
it('move otimista é confirmado no IMAP e um job repetido não movimenta novamente', async () => {
  const m = await db
    .selectFrom('messages')
    .selectAll()
    .where('folder_id', '=', sourceId)
    .where('message_id_header', '=', `<one-${suffix}@cliente.local>`)
    .executeTakeFirstOrThrow();
  const response = await api('POST', `/api/mailboxes/${boxId}/messages/actions`, owner, {
    type: 'move',
    message_ids: [m.id],
    target_folder_id: targetId,
  });
  expect(response.statusCode, response.body).toBe(202);
  const optimistic = await db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', m.id)
    .executeTakeFirstOrThrow();
  expect(optimistic.folder_id).toBe(targetId);
  expect(optimistic.pending_action).toBe(true);
  const action = response.json().action_id;
  await handleMailAction(r, action, 'qa-action', true);
  await handleMailAction(r, action, 'qa-action-repeated', true);
  const done = await db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', m.id)
    .executeTakeFirstOrThrow();
  expect(done.pending_action).toBe(false);
  expect(done.imap_uid).toBeTruthy();
  const t = await client();
  try {
    await t.imap.connect();
    const lock = await t.imap.getMailboxLock(targetPath);
    try {
      const uids = await t.imap.search(
        { header: { 'Message-ID': m.message_id_header } },
        { uid: true },
      );
      expect(uids).toEqual([Number(done.imap_uid)]);
    } finally {
      lock.release();
    }
  } finally {
    await t.close();
  }
}, 30000);
it('sinaliza no servidor, exclui para Lixeira, restaura e exclui definitivamente', async () => {
  const m = await db
    .selectFrom('messages')
    .selectAll()
    .where('folder_id', '=', targetId)
    .where('deleted_at', 'is', null)
    .executeTakeFirstOrThrow();
  for (const b of [
    { type: 'set_flag', flagged: true },
    { type: 'delete' },
    { type: 'restore' },
    { type: 'delete' },
    { type: 'delete' },
  ]) {
    const response = await api('POST', `/api/mailboxes/${boxId}/messages/actions`, owner, {
      ...b,
      message_ids: [m.id],
    });
    expect(response.statusCode).toBe(202);
    await handleMailAction(r, response.json().action_id, 'qa-' + randomUUID(), true);
    const row = await db
      .selectFrom('messages')
      .selectAll()
      .where('id', '=', m.id)
      .executeTakeFirstOrThrow();
    expect(row.pending_action).toBe(false);
    if (b.type === 'set_flag') expect(row.is_flagged).toBe(true);
  }
  expect(
    (
      await db
        .selectFrom('messages')
        .select('deleted_at')
        .where('id', '=', m.id)
        .executeTakeFirstOrThrow()
    ).deleted_at,
  ).not.toBeNull();
  expect(trashId).toBeTruthy();
}, 60000);
it('reconcilia remoção externa e uma mudança de UIDVALIDITY sem duplicar mensagens ativas', async () => {
  const m = await db
    .selectFrom('messages')
    .selectAll()
    .where('folder_id', '=', sourceId)
    .where('deleted_at', 'is', null)
    .orderBy('imap_uid')
    .executeTakeFirstOrThrow();
  const t = await client();
  try {
    await t.imap.connect();
    const lock = await t.imap.getMailboxLock(sourcePath);
    try {
      await t.imap.messageDelete([Number(m.imap_uid)], { uid: true });
    } finally {
      lock.release();
    }
    const old = await t.imap.mailboxOpen(resetPath);
    await t.imap.mailboxClose();
    await t.imap.mailboxDelete(resetPath);
    await delay(1100);
    await t.imap.mailboxCreate(resetPath);
    const raw = `From: cliente@cliente.local\r\nTo: comercial@apmail.local\r\nSubject: UIDValidity ${suffix}\r\nMessage-ID: <uid-${suffix}@cliente.local>\r\nDate: ${new Date().toUTCString()}\r\n\r\nNova pasta.\r\n`;
    await t.imap.append(resetPath, raw);
    const next = await t.imap.mailboxOpen(resetPath);
    expect(String(next.uidValidity)).not.toBe(String(old.uidValidity));
  } finally {
    await t.close();
  }
  await db
    .updateTable('mailboxes')
    .set({ last_reconciled_at: null })
    .where('id', '=', boxId)
    .execute();
  await sync();
  expect(
    (
      await db
        .selectFrom('messages')
        .select('deleted_at')
        .where('id', '=', m.id)
        .executeTakeFirstOrThrow()
    ).deleted_at,
  ).not.toBeNull();
  const reset = await db
    .selectFrom('messages')
    .select('id')
    .where('mailbox_id', '=', boxId)
    .where('message_id_header', '=', `<uid-${suffix}@cliente.local>`)
    .where('deleted_at', 'is', null)
    .execute();
  expect(reset).toHaveLength(1);
}, 60000);
it('lock impede concorrência e não remove lock pertencente a outro job', async () => {
  const lockId = 'qa-' + suffix;
  let work = 0;
  const first = withMailboxLock(redis, lockId, 'one', async () => {
    work++;
    await delay(250);
    return 'first';
  });
  await delay(50);
  expect(
    await withMailboxLock(redis, lockId, 'two', async () => {
      work++;
    }),
  ).toBe('skipped');
  await first;
  expect(work).toBe(1);
  await withMailboxLock(redis, lockId, 'three', async () => {
    await redis.set('lock:mailbox-sync:' + lockId, 'other', 'PX', 1000);
  });
  expect(await redis.get('lock:mailbox-sync:' + lockId)).toBe('other');
  await redis.del('lock:mailbox-sync:' + lockId);
});
it('recria scheduler perdido a partir do Postgres', async () => {
  await r.queues['mailbox-sync'].removeJobScheduler('sync:' + boxId);
  await ensureSchedulers(r);
  expect(await r.queues['mailbox-sync'].getJobScheduler('sync:' + boxId)).toBeTruthy();
});
it('senha inválida gera erro humano e notificação única; corrigir e reconectar volta a ativa', async () => {
  await writeMailboxCredential(db, tenantId, boxId, 'SenhaErrada', key);
  await db.updateTable('mailboxes').set({ status: 'pending' }).where('id', '=', boxId).execute();
  await handleMailboxConnection(r, boxId);
  const failed = await db
    .selectFrom('mailboxes')
    .selectAll()
    .where('id', '=', boxId)
    .executeTakeFirstOrThrow();
  expect(failed.status).toBe('error');
  expect(failed.last_error).toContain('Usuário ou senha inválidos');
  await markMailboxError(r, failed, { code: 'EAUTH' });
  const notifications = await db
    .selectFrom('notifications')
    .select('id')
    .where('tenant_id', '=', tenantId)
    .where('type', '=', 'mailbox_error')
    .execute();
  expect(notifications).toHaveLength(1);
  await writeMailboxCredential(db, tenantId, boxId, 'Senha123', key);
  await db.updateTable('mailboxes').set({ status: 'pending' }).where('id', '=', boxId).execute();
  await handleMailboxConnection(r, boxId);
  expect(
    (
      await db
        .selectFrom('mailboxes')
        .select('status')
        .where('id', '=', boxId)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('active');
}, 60000);
it('agregados retiram mensagens da Lixeira das filas e newsletter não requer resposta', async () => {
  const automated = await db
    .selectFrom('messages')
    .select(['id', 'thread_id'])
    .where('mailbox_id', '=', boxId)
    .where('message_id_header', '=', `<newsletter-${suffix}@cliente.local>`)
    .executeTakeFirst();
  expect(automated).toBeTruthy();
  if (automated) {
    await db.transaction().execute((trx) => touchThreads(trx, [automated.thread_id], 'sync', null));
    expect(
      (
        await db
          .selectFrom('threads')
          .select('queue_status')
          .where('id', '=', automated.thread_id)
          .executeTakeFirstOrThrow()
      ).queue_status,
    ).toBe('none');
  }
});

it('anexos e CID exigem acesso à caixa e nunca expõem caminhos físicos', async () => {
  const message = await db
    .selectFrom('messages')
    .select(['id', 'thread_id'])
    .where('mailbox_id', '=', boxId)
    .where('message_id_header', '=', `<attachments-${suffix}@cliente.local>`)
    .executeTakeFirstOrThrow();
  const response = await api('GET', '/api/threads/' + message.thread_id, viewer);
  expect(response.statusCode).toBe(200);
  const attachments = response
    .json()
    .messages.find((m: { id: string }) => m.id === message.id).attachments;
  expect(attachments).toHaveLength(2);
  expect(response.body).not.toContain('storage_path');
  const image = attachments.find((a: { content_type: string }) => a.content_type === 'image/png');
  expect(response.json().cid_map['imagem-interna']).toBe(image.id);
  const inline = await api('GET', '/api/attachments/' + image.id + '/inline', viewer);
  expect(inline.statusCode).toBe(200);
  expect(inline.headers['x-content-type-options']).toBe('nosniff');
  expect(inline.rawPayload.length).toBeGreaterThan(10);
});

const outboxIds: string[] = [];
async function newDraft(user = editor, extra: Record<string, unknown> = {}) {
  const res = await api('POST', '/api/outbox', user, {
    mailbox_id: boxId,
    subject: 'Envio QA ' + suffix,
    to_addresses: [{ name: 'Cliente', address: 'cliente@cliente.local' }],
    body_html: '<p>Mensagem QA</p>',
    ...extra,
  });
  expect(res.statusCode, res.body).toBe(201);
  outboxIds.push(res.json().id);
  return res.json();
}
async function sendDraft(id: string, user = editor) {
  const submitted = await api('POST', '/api/outbox/' + id + '/submit', user, {});
  expect(submitted.statusCode, submitted.body).toBe(200);
  await db
    .updateTable('outbox')
    .set({ send_after: new Date(Date.now() - 1000) })
    .where('id', '=', id)
    .execute();
  await handleOutboxSend(r, id, {
    id: submitted.json().job_id,
    attemptsMade: 0,
    opts: { attempts: 3 },
  });
  return db.selectFrom('outbox').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
}
it('rascunhos são privados, viewer não envia e cancelamento impede job obsoleto', async () => {
  expect((await api('POST', '/api/outbox', viewer, { mailbox_id: boxId })).statusCode).toBe(403);
  const draft = await newDraft();
  expect((await api('GET', '/api/outbox/' + draft.id, viewer)).statusCode).toBe(404);
  expect(
    (await api('PATCH', '/api/outbox/' + draft.id, owner, { subject: 'Alterar' })).statusCode,
  ).toBe(403);
  const submit = await api('POST', '/api/outbox/' + draft.id + '/submit', editor, {});
  expect(submit.statusCode).toBe(200);
  expect(new Date(submit.json().send_after).getTime() - Date.now()).toBeGreaterThan(9000);
  expect((await api('POST', '/api/outbox/' + draft.id + '/cancel', editor)).statusCode).toBe(200);
  await handleOutboxSend(r, draft.id, {
    id: submit.json().job_id,
    attemptsMade: 0,
    opts: { attempts: 3 },
  });
  expect((await api('GET', '/api/outbox/' + draft.id, editor)).json().status).toBe('draft');
});
it('assinaturas são pessoais e o padrão é único por empresa e escopo', async () => {
  for (const name of ['Primeira', 'Segunda'])
    expect(
      (
        await api('POST', '/api/signatures', editor, {
          name,
          body_html: '<p>Editor QA</p><script>bad()</script>',
          is_default: true,
        })
      ).statusCode,
    ).toBe(201);
  const rows = (await api('GET', '/api/signatures', editor)).json();
  expect(rows.filter((s: { is_default: boolean }) => s.is_default)).toHaveLength(1);
  expect(rows[0].body_html).not.toContain('script');
  expect((await api('GET', '/api/signatures', owner)).json()).toHaveLength(0);
  expect(
    (await api('PATCH', '/api/signatures/' + rows[0].id, owner, { name: 'Outro' })).statusCode,
  ).toBe(404);
});
it('SMTP entrega MIME real com assinatura pessoal, nome do remetente e cópia IMAP sem duplicar', async () => {
  await db
    .updateTable('mailboxes')
    .set({ from_name_template: '{user_name} | {mailbox_name}' })
    .where('id', '=', boxId)
    .execute();
  const signature = (await api('GET', '/api/signatures', editor))
    .json()
    .find((s: { is_default: boolean }) => s.is_default);
  const draft = await newDraft(editor, {
    signature_id: signature.id,
    body_html:
      '<p>Olá</p><div data-apmail-signature="' +
      signature.id +
      '">' +
      signature.body_html +
      '</div>',
  });
  const sent = await sendDraft(draft.id);
  expect(sent.status).toBe('sent');
  const recipient = new ImapFlow({
    host: mailHost,
    port: imapPort,
    secure: false,
    auth: { user: 'cliente@cliente.local', pass: 'Senha123' },
    logger: false,
  });
  recipient.on('error', () => undefined);
  try {
    await recipient.connect();
    await recipient.mailboxOpen('INBOX');
    const ids = await recipient.search(
      { header: { 'X-APMail-Outbox-Id': draft.id } },
      { uid: true },
    );
    expect(Array.isArray(ids) && ids.length).toBeTruthy();
    const m = await recipient.fetchOne((ids as number[])[0]!, { source: true }, { uid: true });
    if (!m || !m.source) throw Error('MIME ausente');
    const parsed = await simpleParser(m.source);
    expect(parsed.from?.value[0]?.address).toBe('comercial@apmail.local');
    expect(parsed.from?.value[0]?.name).toBe('Usuário QA | Caixa Sync QA');
    expect(parsed.html).toContain('Editor QA');
    expect(parsed.messageId).toBe(sent.message_id_header);
    await recipient.messageDelete(ids as number[], { uid: true });
    await recipient.mailboxClose();
  } finally {
    await recipient.logout().catch(() => recipient.close());
  }
  await sync();
  expect(
    await db
      .selectFrom('messages')
      .select('id')
      .where('mailbox_id', '=', boxId)
      .where('message_id_header', '=', sent.message_id_header)
      .where('deleted_at', 'is', null)
      .execute(),
  ).toHaveLength(1);
  const confirmed = await db
    .selectFrom('messages')
    .select('imap_uid')
    .where('id', '=', sent.sent_message_id!)
    .executeTakeFirstOrThrow();
  expect(confirmed.imap_uid).not.toBeNull();
}, 30000);
it('resposta de outro usuário conserva a thread, referências e sua própria assinatura', async () => {
  const original = await db
    .selectFrom('messages')
    .selectAll()
    .where('mailbox_id', '=', boxId)
    .where('message_id_header', '=', '<three-' + suffix + '@cliente.local>')
    .executeTakeFirstOrThrow();
  const sig = (
    await api('POST', '/api/signatures', owner, {
      name: 'Proprietário',
      body_html: '<p>Assinatura do proprietário</p>',
      is_default: true,
    })
  ).json();
  const draft = await newDraft(owner, {
    kind: 'reply',
    thread_id: original.thread_id,
    reply_to_message_id: original.id,
    signature_id: sig.id,
    subject: 'Re: ' + original.subject,
    body_html:
      '<p>Respondido</p><div data-apmail-signature="' + sig.id + '">' + sig.body_html + '</div>',
  });
  const sent = await sendDraft(draft.id, owner);
  expect(sent.thread_id).toBe(original.thread_id);
  const m = await db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', sent.sent_message_id!)
    .executeTakeFirstOrThrow();
  expect(m.in_reply_to).toBe(original.message_id_header);
  expect(m.references_headers).toContain(original.message_id_header);
  expect(m.body_html).toContain('Assinatura do proprietário');
  expect(m.body_html).not.toContain('Editor QA');
  expect(m.sent_by_user_id).toBe(owner);
}, 30000);
it('encaminha anexos originais íntegros e rejeita referência alheia', async () => {
  const attachments = await db
    .selectFrom('attachments')
    .selectAll()
    .where('mailbox_id', '=', boxId)
    .where('is_inline', '=', false)
    .execute();
  const file = attachments[0]!;
  const draft = await newDraft(editor, {
    kind: 'forward',
    attachments: [{ source: 'message_attachment', attachment_id: file.id }],
  });
  const sent = await sendDraft(draft.id);
  const copied = await db
    .selectFrom('attachments')
    .selectAll()
    .where('message_id', '=', sent.sent_message_id!)
    .executeTakeFirstOrThrow();
  const hash = async (path: string) => {
    const stream = await r.storage.openReadStream(path),
      h = createHash('sha256');
    for await (const chunk of stream) h.update(chunk);
    return h.digest('hex');
  };
  expect(await hash(copied.storage_path)).toBe(await hash(file.storage_path));
  expect(
    (
      await api('POST', '/api/outbox', editor, {
        mailbox_id: boxId,
        attachments: [{ source: 'upload', upload_id: randomUUID() }],
      })
    ).statusCode,
  ).toBe(400);
}, 30000);
it('agendamento valida limites, cancelar remove job e sweep recupera perda de Redis', async () => {
  const draft = await newDraft();
  expect(
    (
      await api('POST', '/api/outbox/' + draft.id + '/submit', editor, {
        scheduled_at: new Date(Date.now() + 60000).toISOString(),
      })
    ).statusCode,
  ).toBe(400);
  const res = await api('POST', '/api/outbox/' + draft.id + '/submit', editor, {
    scheduled_at: new Date(Date.now() + 360000).toISOString(),
  });
  expect(res.statusCode, res.body).toBe(200);
  expect(
    (await api('GET', '/api/outbox?tab=scheduled', viewer))
      .json()
      .items.some((o: { id: string }) => o.id === draft.id),
  ).toBe(true);
  await r.queues['outbox-send'].remove(res.json().job_id);
  await db
    .updateTable('outbox')
    .set({ send_after: new Date(Date.now() - 31000) })
    .where('id', '=', draft.id)
    .execute();
  await sweepOutbox(r);
  expect(await r.queues['outbox-send'].getJob(res.json().job_id)).toBeTruthy();
  expect((await api('POST', '/api/outbox/' + draft.id + '/cancel', owner)).statusCode).toBe(200);
  expect(await r.queues['outbox-send'].getJob(res.json().job_id)).toBeUndefined();
  expect((await api('GET', '/api/outbox/' + draft.id, viewer)).json().status).toBe('canceled');
});
it('SMTP indisponível retenta três vezes, notifica e Tentar novamente entrega', async () => {
  const draft = await newDraft();
  await db.updateTable('mailboxes').set({ smtp_port: 1 }).where('id', '=', boxId).execute();
  const submitted = await api('POST', '/api/outbox/' + draft.id + '/submit', editor, {});
  expect(submitted.statusCode).toBe(200);
  await db
    .updateTable('outbox')
    .set({ send_after: new Date(Date.now() - 1000) })
    .where('id', '=', draft.id)
    .execute();
  const delayed = await r.queues['outbox-send'].getJob(submitted.json().job_id);
  await delayed!.promote();
  const worker = new Worker('outbox-send', (job) => handleOutboxSend(r, job.data.outbox_id, job), {
    connection: redis,
    prefix: 'apmail',
    settings: { backoffStrategy: () => 25 },
  });
  worker.on('error', () => undefined);
  try {
    for (let i = 0; i < 100; i++) {
      const row = await db
        .selectFrom('outbox')
        .select(['status', 'attempts'])
        .where('id', '=', draft.id)
        .executeTakeFirstOrThrow();
      if (row.status === 'failed') {
        expect(row.attempts).toBe(3);
        break;
      }
      if (i === 99) throw Error('Falha não consolidada');
      await delay(100);
    }
  } finally {
    await worker.close();
  }
  expect(
    await db
      .selectFrom('notifications')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('user_id', '=', editor)
      .where('type', '=', 'send_failed')
      .execute(),
  ).toHaveLength(1);
  await db.updateTable('mailboxes').set({ smtp_port: smtpPort }).where('id', '=', boxId).execute();
  const retry = await api('POST', '/api/outbox/' + draft.id + '/retry', editor);
  expect(retry.statusCode, retry.body).toBe(200);
  await handleOutboxSend(r, draft.id, {
    id: retry.json().job_id,
    attemptsMade: 0,
    opts: { attempts: 3 },
  });
  expect((await api('GET', '/api/outbox/' + draft.id, editor)).json().status).toBe('sent');
}, 30000);
