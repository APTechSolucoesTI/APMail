import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { simpleParser } from 'mailparser';
import type { ImapFlow } from 'imapflow';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import pino from 'pino';
import {
  createDb,
  migrate,
  createQueues,
  Storage,
  asJson,
  ensureLocalFolders,
  advanceRecurringOutbox,
  registerSecurityFile,
} from '@apmail/db';
import { buildApp } from '../../../api/src/app.js';
import { envSchema as apiEnv } from '../../../api/src/env.js';
import { envSchema as workerEnv } from '../../src/env.js';
import { hashToken } from '../../../api/src/plugins/auth.js';
import { applyPendingRules, handleRulesApply } from '../../src/handlers/rules-apply.js';
import { handleOutboxSend } from '../../src/handlers/outbox-send.js';
import { cleanupUploads, sweepOutbox } from '../../src/handlers/outbox-maintenance.js';
import { ingestMessage } from '../../src/imap/ingest-message.js';
import * as providers from '../../src/imap/connect.js';
import type { WorkerResources } from '../../src/resources.js';
const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (!url || !new URL(url).pathname.endsWith('_test') || !redisUrl)
  throw new Error('Banco e fila exclusivos de QA obrigatórios.');
const db = createDb(url),
  tenant = randomUUID(),
  owner = randomUUID(),
  viewer = randomUUID(),
  foreign = randomUUID(),
  foreignTenant = randomUUID();
const secret = randomBytes(32).toString('base64'),
  dir = await mkdtemp(join(tmpdir(), 'apmail-rules-schedule-'));
const config = {
  NODE_ENV: 'test',
  DATABASE_URL: url,
  REDIS_URL: redisUrl,
  APP_URL: 'http://localhost:5173',
  SESSION_SECRET: secret,
  CREDENTIALS_ENCRYPTION_KEY: secret,
  STORAGE_DIR: dir,
};
const app = await buildApp(apiEnv.parse(config)),
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null }),
  queues = createQueues(redisUrl);
const r: WorkerResources = {
  db,
  redis,
  queues: queues.queues,
  io: new Emitter(redis),
  log: pino({ level: 'silent' }),
  env: workerEnv.parse(config),
  storage: new Storage(dir, db),
};
const cookies = new Map<string, string>();
let box: Awaited<ReturnType<typeof mailbox>>;
async function mailbox(
  name = 'QA',
  email = randomUUID() + '@qa.example',
  protocol: 'pop3' | 'local' = 'pop3',
) {
  const saved = await db
    .insertInto('mailboxes')
    .values({
      tenant_id: tenant,
      created_by: owner,
      name,
      email_address: email,
      receiving_protocol: protocol,
      imap_host: '127.0.0.1',
      smtp_host: '127.0.0.1',
      username: 'qa',
      status: 'active',
      history_classify_days: 0,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await ensureLocalFolders(db, tenant, saved.id);
  return saved;
}
const call = (
  method: 'GET' | 'POST' | 'PATCH' | 'PUT',
  path: string,
  body?: unknown,
  user = owner,
) =>
  app.inject({
    method,
    url: '/api' + path,
    headers: {
      origin: config.APP_URL,
      cookie: cookies.get(user) ?? '',
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
  });
async function message(target = box, subject = 'Regra orçamento aprovado') {
  const folder = await db
    .selectFrom('folders')
    .select('id')
    .where('mailbox_id', '=', target.id)
    .where('special_use', '=', 'inbox')
    .executeTakeFirstOrThrow();
  const thread = await db
    .insertInto('threads')
    .values({
      tenant_id: tenant,
      mailbox_id: target.id,
      subject,
      subject_normalized: subject,
      queue_status: 'to_reply',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const item = await db
    .insertInto('messages')
    .values({
      tenant_id: tenant,
      mailbox_id: target.id,
      thread_id: thread.id,
      folder_id: folder.id,
      message_id_header: '<' + randomUUID() + '@qa.example>',
      subject,
      from_address: 'henrique.rufino@qa.example',
      from_name: 'Henrique Rufino',
      to_addresses: asJson([{ name: 'QA', address: target.email_address }]),
      direction: 'inbound',
      message_at: new Date(),
      body_text: 'Conteúdo para regras',
      rules_inbox: true,
      source_kind: 'pop3',
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return item;
}
const rule = (mailboxId: string, actions: object[], scope = 'mailbox') => ({
  mailbox_id: mailboxId,
  scope,
  name: 'Regra QA',
  is_active: true,
  priority: 100,
  match_mode: 'all',
  conditions: [{ field: 'subject', operator: 'contains', value: 'orçamento' }],
  actions,
  stop_processing: false,
});
beforeAll(async () => {
  await migrate(url);
  await app.ready();
  await db
    .insertInto('tenants')
    .values([
      { id: tenant, name: 'Rules QA', slug: tenant },
      { id: foreignTenant, name: 'Foreign QA', slug: foreignTenant },
    ])
    .execute();
  for (const [user, company, role, name] of [
    [owner, tenant, 'owner', 'Administrador QA'],
    [viewer, tenant, 'member', 'Henrique Rufino'],
    [foreign, foreignTenant, 'owner', 'Foreign QA'],
  ] as const) {
    await db
      .insertInto('users')
      .values({
        id: user,
        email: randomUUID() + '@qa.example',
        full_name: name,
        password_hash: 'fixture',
        current_tenant_id: company,
      })
      .execute();
    await db
      .insertInto('tenant_members')
      .values({ tenant_id: company, user_id: user, role })
      .execute();
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
  box = await mailbox();
  await db
    .insertInto('mailbox_members')
    .values({ tenant_id: tenant, mailbox_id: box.id, user_id: viewer, role: 'viewer' })
    .execute();
}, 30000);
afterAll(async () => {
  vi.restoreAllMocks();
  await app.close();
  await queues.close();
  await redis.quit();
  await db.destroy();
  await rm(dir, { recursive: true, force: true });
});
it('testa a conversa sem aplicar ações, não remove etiquetas e bloqueia outra empresa', async () => {
  const msg = await message();
  const label = (
    await call('POST', '/labels', { name: 'Global QA', color: '#1686A7', scope: 'tenant' })
  ).json();
  const before = (await call('GET', '/labels?mailbox_id=' + box.id)).json();
  const preview = await call('POST', '/rules/preview', {
    rule: rule(box.id, [{ type: 'add_label', label_id: label.id }]),
    thread_id: msg.thread_id,
  });
  expect(preview.statusCode, preview.body).toBe(200);
  expect(preview.json()).toEqual({ matches: true, conditions: [true] });
  expect((await call('GET', '/labels?mailbox_id=' + box.id)).json()).toEqual(before);
  expect(
    await db
      .selectFrom('thread_personal_labels')
      .selectAll()
      .where('thread_id', '=', msg.thread_id)
      .execute(),
  ).toHaveLength(0);
  expect(
    (
      await call(
        'POST',
        '/rules/preview',
        { rule: rule(box.id, [{ type: 'pin' }]), thread_id: msg.thread_id },
        foreign,
      )
    ).statusCode,
  ).toBe(404);
});
it('aplica todas as ações locais em POP3, incluindo fixação global e pessoal; reaplica sem duplicar', async () => {
  const msg = await message();
  const destination = await db
    .insertInto('folders')
    .values({
      tenant_id: tenant,
      mailbox_id: box.id,
      name: 'Projetos',
      imap_path: 'local/projetos',
      is_local: true,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const global = (
    await call('POST', '/labels', {
      name: 'Compartilhada regras',
      color: '#1686A7',
      scope: 'tenant',
    })
  ).json();
  const personal = (
    await call('POST', '/labels', { name: 'Pessoal regras', color: '#1686A7' })
  ).json();
  const shared = await call(
    'POST',
    '/rules',
    rule(box.id, [
      { type: 'move_to_folder', folder_id: destination.id },
      { type: 'mark_flagged' },
      { type: 'add_label', label_id: global.id },
      { type: 'exclude_from_queue' },
      { type: 'pin' },
    ]),
  );
  expect(shared.statusCode, shared.body).toBe(201);
  const privateRule = await call(
    'POST',
    '/rules',
    rule(box.id, [{ type: 'add_label', label_id: personal.id }, { type: 'pin' }], 'personal'),
  );
  expect(privateRule.statusCode).toBe(201);
  await applyPendingRules(r, box, null);
  const saved = await db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', msg.id)
    .executeTakeFirstOrThrow();
  expect(saved).toMatchObject({ folder_id: destination.id, is_flagged: true });
  expect(saved.rules_applied_at).not.toBeNull();
  expect(
    await db
      .selectFrom('threads')
      .selectAll()
      .where('id', '=', msg.thread_id)
      .executeTakeFirstOrThrow(),
  ).toMatchObject({ queue_excluded: true, is_pinned_global: true });
  const detail = (await call('GET', '/threads/' + msg.thread_id)).json();
  expect(detail).toMatchObject({
    is_pinned: true,
    is_pinned_personal: true,
    is_pinned_global: true,
  });
  expect(detail.labels).toHaveLength(2);
  expect((await call('GET', '/threads/' + msg.thread_id, undefined, viewer)).json()).toMatchObject({
    is_pinned: true,
    is_pinned_personal: false,
    is_pinned_global: true,
  });
  await handleRulesApply(r, shared.json().id, 30, 'reapply-qa');
  expect(
    await db
      .selectFrom('thread_personal_labels')
      .select('label_id')
      .where('thread_id', '=', msg.thread_id)
      .execute(),
  ).toHaveLength(2);
  expect(
    (await call('POST', '/threads/' + msg.thread_id + '/pin', { scope: 'mailbox' }, viewer))
      .statusCode,
  ).toBe(403);
  expect(
    (await call('POST', '/threads/' + msg.thread_id + '/pin', { scope: 'mailbox' })).statusCode,
  ).toBe(200);
  expect((await call('GET', '/threads/' + msg.thread_id, undefined, viewer)).json().is_pinned).toBe(
    false,
  );
  expect(
    (
      await call(
        'POST',
        '/rules',
        rule(box.id, [{ type: 'move_to_folder', folder_id: destination.id }], 'personal'),
        viewer,
      )
    ).statusCode,
  ).toBe(403);
}, 30000);
it('não registra sinalização ou movimentação recusada pelo IMAP e retoma sem perder a mensagem', async () => {
  const local = await mailbox('IMAP QA');
  const target = await db
    .updateTable('mailboxes')
    .set({ receiving_protocol: 'imap' })
    .where('id', '=', local.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  const msg = await message(target);
  await db
    .updateTable('folders')
    .set({ is_local: false })
    .where('mailbox_id', '=', target.id)
    .execute();
  await db
    .updateTable('messages')
    .set({ source_kind: 'imap', imap_uid: 1 })
    .where('id', '=', msg.id)
    .execute();
  const destination = await db
    .insertInto('folders')
    .values({
      tenant_id: tenant,
      mailbox_id: target.id,
      name: 'Destino IMAP',
      imap_path: 'Projetos',
      is_local: false,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const saved = await call('POST', '/rules', {
    ...rule(target.id, [
      { type: 'mark_flagged' },
      { type: 'move_to_folder', folder_id: destination.id },
    ]),
    apply_existing: true,
    apply_since_days: null,
  });
  expect(saved.statusCode, saved.body).toBe(201);
  const job = (await queues.queues['rules-apply'].getJobs(['wait'])).find(
    (item) => item.data.rule_id === saved.json().id,
  );
  expect(job?.opts.attempts).toBe(5);
  expect(job?.data.since_days).toBeNull();
  const flag = vi.fn().mockResolvedValue(false),
    move = vi.fn().mockResolvedValue(false);
  const client = {
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    messageFlagsAdd: flag,
    messageMove: move,
  } as unknown as ImapFlow;
  await expect(applyPendingRules(r, target, client)).rejects.toThrow('não confirmou a sinalização');
  expect(
    await db
      .selectFrom('messages')
      .select(['is_flagged', 'folder_id', 'rules_applied_at'])
      .where('id', '=', msg.id)
      .executeTakeFirstOrThrow(),
  ).toMatchObject({ is_flagged: false, folder_id: msg.folder_id, rules_applied_at: null });
  flag.mockResolvedValue(true);
  await expect(applyPendingRules(r, target, client)).rejects.toThrow(
    'não confirmou a movimentação',
  );
  expect(
    await db
      .selectFrom('messages')
      .select(['folder_id', 'rules_applied_at'])
      .where('id', '=', msg.id)
      .executeTakeFirstOrThrow(),
  ).toMatchObject({ folder_id: msg.folder_id, rules_applied_at: null });
  move.mockResolvedValue({ uidMap: new Map([[1, 7]]) });
  await applyPendingRules(r, target, client);
  const result = await db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', msg.id)
    .executeTakeFirstOrThrow();
  expect(result.folder_id).toBe(destination.id);
  expect(Number(result.imap_uid)).toBe(7);
  expect(result.rules_applied_at).not.toBeNull();
});
it('busca endereços já usados, contas e usuários sem depender de um contato', async () => {
  const other = await mailbox('Henrique Caixa', 'henrique.conta@qa.example');
  await message(other);
  const result = (await call('GET', '/mailboxes/' + box.id + '/address-suggestions?q=he')).json();
  expect(
    result.some((item: { address: string }) => item.address === 'henrique.rufino@qa.example'),
  ).toBe(true);
  expect(
    result.some((item: { address: string }) => item.address === 'henrique.conta@qa.example'),
  ).toBe(true);
  expect(result.some((item: { source: string }) => item.source === 'user')).toBe(true);
  const restricted = (
    await call('GET', '/mailboxes/' + box.id + '/address-suggestions?q=he', undefined, viewer)
  ).json();
  expect(
    restricted.some((item: { address: string }) => item.address === 'henrique.conta@qa.example'),
  ).toBe(false);
  expect(
    (await call('GET', '/mailboxes/' + box.id + '/address-suggestions?q=he', undefined, foreign))
      .statusCode,
  ).toBe(404);
});
it('atribui responsável, encaminha uma vez e respeita a desativação antes do envio', async () => {
  const target = await mailbox('Encaminhamento QA');
  await db
    .insertInto('mailbox_members')
    .values({ mailbox_id: target.id, tenant_id: tenant, user_id: viewer, role: 'editor' })
    .execute();
  await db
    .updateTable('tenants')
    .set({ settings: asJson({ allow_external_auto_forward: true }) })
    .where('id', '=', tenant)
    .execute();
  const msg = await message(target);
  const saved = await call(
    'POST',
    '/rules',
    rule(target.id, [
      { type: 'assign_to', user_id: viewer },
      { type: 'forward_to', address: 'arquivo@qa.example' },
    ]),
  );
  expect(saved.statusCode, saved.body).toBe(201);
  await applyPendingRules(r, target, null);
  await handleRulesApply(r, saved.json().id, null, 'reapply-forward');
  expect(
    (
      await db
        .selectFrom('threads')
        .select('assigned_to')
        .where('id', '=', msg.thread_id)
        .executeTakeFirstOrThrow()
    ).assigned_to,
  ).toBe(viewer);
  const jobs = await db
    .selectFrom('outbox')
    .selectAll()
    .where('created_by_rule_id', '=', saved.json().id)
    .execute();
  expect(jobs).toHaveLength(1);
  await db
    .updateTable('tenants')
    .set({ settings: asJson({ allow_external_auto_forward: false }) })
    .where('id', '=', tenant)
    .execute();
  const transport = vi.spyOn(providers, 'transports');
  await handleOutboxSend(r, jobs[0]!.id, {
    id: jobs[0]!.job_id!,
    attemptsMade: 0,
    opts: { attempts: 1 },
  }).catch(() => undefined);
  expect(transport.mock.calls).toHaveLength(0);
  transport.mockRestore();
  expect(
    (
      await db
        .selectFrom('outbox')
        .select('status')
        .where('id', '=', jobs[0]!.id)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('failed');
}, 30000);
it('aplica a regra a mensagens antigas quando o usuário escolhe todo o histórico', async () => {
  const target = await mailbox('Histórico QA'),
    msg = await message(target);
  await db
    .updateTable('messages')
    .set({ message_at: new Date('2001-01-01T12:00:00Z') })
    .where('id', '=', msg.id)
    .execute();
  const saved = await call('POST', '/rules', rule(target.id, [{ type: 'mark_flagged' }]));
  expect(saved.statusCode).toBe(201);
  await handleRulesApply(r, saved.json().id, 30, 'recent-only');
  expect(
    (
      await db
        .selectFrom('messages')
        .select('is_flagged')
        .where('id', '=', msg.id)
        .executeTakeFirstOrThrow()
    ).is_flagged,
  ).toBe(false);
  await handleRulesApply(r, saved.json().id, null, 'whole-history');
  expect(
    (
      await db
        .selectFrom('messages')
        .select('is_flagged')
        .where('id', '=', msg.id)
        .executeTakeFirstOrThrow()
    ).is_flagged,
  ).toBe(true);
});
it('preserva anexos de envios com falha na limpeza para permitir uma nova tentativa', async () => {
  const target = await mailbox('Retenção de anexos QA');
  const uploadId = randomUUID(),
    storagePath = `uploads/${tenant}/${target.id}/${owner}/${uploadId}`,
    binary = Buffer.from('Documento preservado para nova tentativa');
  await r.storage.writeFile(storagePath, binary);
  await db
    .insertInto('uploads')
    .values({
      id: uploadId,
      tenant_id: tenant,
      mailbox_id: target.id,
      user_id: owner,
      filename: 'documento.txt',
      content_type: 'text/plain',
      size_bytes: binary.length,
      storage_path: storagePath,
      created_at: new Date(Date.now() - 2 * 86400000),
    })
    .execute();
  const draft = await call('POST', '/outbox', {
    mailbox_id: target.id,
    to_addresses: [{ name: 'Cliente', address: 'cliente@qa.example' }],
    subject: 'Retenção QA',
    body_html: '<p>Documento</p>',
    attachments: [{ source: 'upload', upload_id: uploadId }],
  });
  expect(draft.statusCode, draft.body).toBe(201);
  await db
    .updateTable('outbox')
    .set({ status: 'failed' })
    .where('id', '=', draft.json().id)
    .execute();
  await cleanupUploads(r);
  // Retention and retry use a verified synthetic fixture; pending files stay blocked.
  await registerSecurityFile(db, {
    storage_key: storagePath,
    tenant_id: tenant,
    mailbox_id: target.id,
    user_id: owner,
    resource_id: uploadId,
    filename: 'documento.txt',
    content_type: 'text/plain',
    size_bytes: binary.length,
    kind: 'upload',
  });
  await db
    .updateTable('file_security')
    .set({
      status: 'clean',
      sha256: createHash('sha256').update(binary).digest('hex'),
      scanned_at: new Date(),
    })
    .where('storage_key', '=', storagePath)
    .execute();
  const retry = await call('POST', '/outbox/' + draft.json().id + '/retry', {});
  expect(retry.statusCode, retry.body).toBe(200);
  expect(retry.json().status).toBe('queued');
  expect(await readFile(join(dir, storagePath))).toEqual(binary);
});
it('agenda, envia pelo transportador de QA, recupera uma única próxima ocorrência e encerra após a quantidade', async () => {
  const target = await mailbox('Recorrência QA');
  const smtp = vi.fn().mockResolvedValue({ accepted: ['destino@qa.example'] });
  const fake = {
    smtp: { sendMail: smtp },
    imap: { connect: vi.fn() },
    close: vi.fn().mockResolvedValue(undefined),
  };
  const transport = vi
    .spyOn(providers, 'transports')
    .mockResolvedValue(fake as unknown as Awaited<ReturnType<typeof providers.transports>>);
  try {
    const binary = Buffer.from([0, 255, 13, 10, 128, 42]);
    const boundary = 'recurrence-' + randomUUID();
    const uploaded = await app.inject({
      method: 'POST',
      url: '/api/uploads?mailbox_id=' + target.id,
      headers: {
        cookie: cookies.get(owner)!,
        origin: config.APP_URL,
        'content-type': 'multipart/form-data; boundary=' + boundary,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="relatorio.bin"\r\nContent-Type: application/octet-stream\r\n\r\n`,
        ),
        binary,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    expect(uploaded.statusCode, uploaded.body).toBe(201);
    // The scanner/SMTP security boundary is covered separately by antivirus-flow.
    await db
      .updateTable('file_security')
      .set({
        status: 'clean',
        sha256: createHash('sha256').update(binary).digest('hex'),
        scanned_at: new Date(),
      })
      .where('resource_id', '=', uploaded.json().id)
      .execute();
    const draft = await call('POST', '/outbox', {
      mailbox_id: target.id,
      to_addresses: [{ name: 'Destino', address: 'destino@qa.example' }],
      subject: 'Recorrência QA',
      body_html: '<p>Olá recorrência</p>',
      attachments: [{ source: 'upload', upload_id: uploaded.json().id }],
    });
    expect(draft.statusCode, draft.body).toBe(201);
    const schedule = new Date(Date.now() + 600000).toISOString();
    const submitted = await call('POST', '/outbox/' + draft.json().id + '/submit', {
      scheduled_at: schedule,
      recurrence: { unit: 'day', interval: 2, timezone: 'America/Sao_Paulo', max_occurrences: 2 },
    });
    expect(submitted.statusCode, submitted.body).toBe(200);
    const first = submitted.json();
    expect(first.recurrence_id).toBeTruthy();
    await db
      .updateTable('outbox')
      .set({ send_after: new Date(Date.now() - 1000) })
      .where('id', '=', first.id)
      .execute();
    await handleOutboxSend(r, first.id, {
      id: first.job_id,
      attemptsMade: 0,
      opts: { attempts: 1 },
    });
    expect(smtp).toHaveBeenCalledTimes(1);
    const firstMime = await simpleParser(smtp.mock.calls[0]![0].raw as Buffer);
    expect(firstMime.attachments[0]?.content).toEqual(binary);
    const consumedUpload = await db
      .selectFrom('uploads')
      .selectAll()
      .where('id', '=', uploaded.json().id)
      .executeTakeFirstOrThrow();
    expect(consumedUpload.consumed_at).not.toBeNull();
    expect(await r.storage.inspect(consumedUpload.storage_path)).toBeNull();
    expect(
      (
        await db
          .selectFrom('outbox')
          .select('status')
          .where('id', '=', first.id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe('sent');
    await Promise.all([advanceRecurringOutbox(db, first.id), advanceRecurringOutbox(db, first.id)]);
    await sweepOutbox(r);
    const occurrences = await db
      .selectFrom('outbox')
      .selectAll()
      .where('recurrence_id', '=', first.recurrence_id)
      .orderBy('recurrence_sequence')
      .execute();
    expect(occurrences).toHaveLength(2);
    expect(occurrences[1]!.attachments).toEqual([
      expect.objectContaining({ source: 'message_attachment', inline: false }),
    ]);
    // Simulate a queue publication lost after the database commit.
    const scheduledJob = await queues.queues['outbox-send'].getJob(occurrences[1]!.job_id!);
    expect(scheduledJob).toBeTruthy();
    await scheduledJob!.remove();
    await sweepOutbox(r);
    expect(await queues.queues['outbox-send'].getJob(occurrences[1]!.job_id!)).toBeTruthy();
    expect(occurrences[1]).toMatchObject({
      status: 'scheduled',
      recurrence_sequence: 2,
      subject: 'Recorrência QA',
    });
    expect(occurrences[1]!.scheduled_at!.getTime() - new Date(schedule).getTime()).toBe(
      2 * 86400000,
    );
    await db
      .updateTable('outbox')
      .set({ send_after: new Date(Date.now() - 1000) })
      .where('id', '=', occurrences[1]!.id)
      .execute();
    await handleOutboxSend(r, occurrences[1]!.id, {
      id: occurrences[1]!.job_id!,
      attemptsMade: 0,
      opts: { attempts: 1 },
    });
    expect(smtp).toHaveBeenCalledTimes(2);
    const secondMime = await simpleParser(smtp.mock.calls[1]![0].raw as Buffer);
    expect(secondMime.attachments[0]?.content).toEqual(binary);
    expect(secondMime.attachments[0]?.filename).toBe('relatorio.bin');
    expect(
      (
        await db
          .selectFrom('mail_schedule_series')
          .select('state')
          .where('id', '=', first.recurrence_id)
          .executeTakeFirstOrThrow()
      ).state,
    ).toBe('completed');
  } finally {
    transport.mockRestore();
  }
}, 30000);
it('cancela a série inteira e impede recuperação de novos envios', async () => {
  const draft = (
    await call('POST', '/outbox', {
      mailbox_id: box.id,
      to_addresses: [{ name: '', address: 'destino@qa.example' }],
      subject: 'Cancelar QA',
    })
  ).json();
  const submitted = await call('POST', '/outbox/' + draft.id + '/submit', {
    scheduled_at: new Date(Date.now() + 600000).toISOString(),
    recurrence: { unit: 'week', interval: 1, timezone: 'America/Sao_Paulo' },
  });
  expect(submitted.statusCode).toBe(200);
  const series = submitted.json().recurrence_id;
  await expect(
    db
      .insertInto('outbox')
      .values({
        tenant_id: tenant,
        mailbox_id: box.id,
        created_by: owner,
        recurrence_id: series,
        recurrence_sequence: null,
      })
      .execute(),
  ).rejects.toThrow('outbox_recurrence_sequence');
  expect(
    (await call('POST', '/outbox/recurrences/' + series + '/cancel', {}, viewer)).statusCode,
  ).toBe(403);
  await db.updateTable('outbox').set({ status: 'failed' }).where('id', '=', draft.id).execute();
  expect((await call('POST', '/outbox/recurrences/' + series + '/cancel')).statusCode).toBe(200);
  await sweepOutbox(r);
  expect(
    (
      await db
        .selectFrom('outbox')
        .select('status')
        .where('id', '=', draft.id)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('canceled');
  expect(
    (
      await db
        .selectFrom('mail_schedule_series')
        .select('state')
        .where('id', '=', series)
        .executeTakeFirstOrThrow()
    ).state,
  ).toBe('cancelled');
});

it('resposta automática: novas mensagens, MIME real, intervalo global, exceções e reexecução segura', async () => {
  const target = await mailbox('Férias QA');
  const input = {
    ...rule(target.id, [
      {
        type: 'auto_reply',
        subject: 'Férias',
        message: 'Olá! Estou de férias. <Não citar original>',
        cooldown_hours: 168,
      },
    ]),
    match_mode: 'always',
    conditions: [],
    exceptions: [{ field: 'from', operator: 'contains', value: 'ignorar@' }],
  };
  expect((await call('POST', '/rules', { ...input, scope: 'personal' })).statusCode).toBe(400);
  expect((await call('POST', '/rules', input, viewer)).statusCode).toBe(404);
  expect((await call('POST', '/rules', input, foreign)).statusCode).toBe(404);
  const created = await call('POST', '/rules', input);
  expect(created.statusCode, created.body).toBe(201);
  const ruleId = created.json().id;
  expect((await call('PATCH', '/rules/' + ruleId, { apply_existing: true })).statusCode).toBe(409);
  const incoming = async (sender = 'cliente@example.net', headers = '', historical = false) => {
    const folder = await db
      .selectFrom('folders')
      .selectAll()
      .where('mailbox_id', '=', target.id)
      .where('special_use', '=', 'inbox')
      .executeTakeFirstOrThrow();
    const source = Buffer.from(
      'Return-Path: <' +
        sender +
        '>\r\nFrom: Cliente <' +
        sender +
        '>\r\nTo: ' +
        target.email_address +
        '\r\nMessage-ID: <' +
        randomUUID() +
        '@example.net>\r\nSubject: Pedido de atendimento\r\n' +
        headers +
        '\r\nConteúdo confidencial original.',
    );
    const thread = await ingestMessage(
      r,
      target,
      folder,
      { uid: 1, seq: 1, source, size: source.length, flags: new Set() },
      { kind: 'pop3', key: randomUUID(), historical },
    );
    return db
      .selectFrom('messages')
      .selectAll()
      .where('thread_id', '=', thread)
      .where('direction', '=', 'inbound')
      .orderBy('created_at', 'desc')
      .executeTakeFirstOrThrow();
  };
  const count = () =>
    db
      .selectFrom('outbox')
      .selectAll()
      .where('mailbox_id', '=', target.id)
      .where('is_auto_reply', '=', true)
      .execute();
  const original = await incoming();
  expect(original.auto_reply_to).toBe('cliente@example.net');
  await applyPendingRules(r, target, null);
  const replies = await count();
  expect(replies).toHaveLength(1);
  const reply = replies[0]!;
  expect(reply).toMatchObject({
    kind: 'reply',
    is_auto_reply: true,
    created_by_rule_id: ruleId,
    reply_to_message_id: original.id,
    status: 'queued',
  });
  expect(reply.body_html).toContain('&lt;Não citar original&gt;');
  expect(reply.body_html).not.toContain('Conteúdo confidencial');
  await incoming();
  await applyPendingRules(r, target, null);
  expect(await count()).toHaveLength(1);
  await db
    .updateTable('messages')
    .set({ rules_applied_at: null })
    .where('id', '=', original.id)
    .execute();
  await applyPendingRules(r, target, null);
  expect(await count()).toHaveLength(1);
  await handleRulesApply(r, ruleId, null, 'auto-reply-no-history');
  expect(await count()).toHaveLength(1);
  for (const [sender, header, historical] of [
    ['ignorar@example.net', '', false],
    ['bot@example.net', 'Auto-Submitted: auto-replied\r\n', false],
    ['historico@example.net', '', true],
  ] as const) {
    await incoming(sender, header, historical);
    await applyPendingRules(r, target, null);
  }
  expect(await count()).toHaveLength(1);
  await call('PATCH', '/rules/' + ruleId, { active_from: '2099-01-01T00:00:00Z' });
  await incoming('future@example.net');
  await applyPendingRules(r, target, null);
  expect(await count()).toHaveLength(1);
  await call('PATCH', '/rules/' + ruleId, {
    active_from: null,
    active_until: '2000-01-01T00:00:00Z',
  });
  await incoming('expired@example.net');
  await applyPendingRules(r, target, null);
  expect(await count()).toHaveLength(1);
  await call('PATCH', '/rules/' + ruleId, { active_until: null });
  const sent: { envelope: { from: string; to: string[] }; raw: Buffer }[] = [];
  const smtp = vi.fn(async (info: { envelope: { from: string; to: string[] }; raw: Buffer }) => {
    sent.push(info);
    return { messageId: 'qa-auto-reply' };
  });
  const transport = vi.spyOn(providers, 'transports').mockResolvedValue({
    smtp: { sendMail: smtp },
    imap: { connect: vi.fn() },
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Awaited<ReturnType<typeof providers.transports>>);
  try {
    await handleOutboxSend(r, reply.id, {
      id: reply.job_id!,
      attemptsMade: 0,
      opts: { attempts: 1 },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]!.envelope).toEqual({ from: '', to: ['cliente@example.net'] });
    const parsed = await simpleParser(sent[0]!.raw);
    expect(parsed.headers.get('auto-submitted')).toBe('auto-replied');
    expect(parsed.headers.get('x-auto-response-suppress')).toBe('All');
    expect(parsed.inReplyTo).toBe(original.message_id_header);
    expect(
      (
        await db
          .selectFrom('threads')
          .selectAll()
          .where('id', '=', original.thread_id)
          .executeTakeFirstOrThrow()
      ).queue_status,
    ).toBe('to_reply');
    await handleOutboxSend(r, reply.id, {
      id: reply.job_id!,
      attemptsMade: 0,
      opts: { attempts: 1 },
    });
    expect(sent).toHaveLength(1);
  } finally {
    transport.mockRestore();
  }
  await db
    .updateTable('mail_auto_reply_state')
    .set({ last_replied_at: new Date(Date.now() - 169 * 3600000) })
    .where('mailbox_id', '=', target.id)
    .execute();
  await incoming();
  await applyPendingRules(r, target, null);
  expect(await count()).toHaveLength(2);
  await call('POST', '/rules', { ...input, name: 'Segunda resposta' });
  await incoming('outro@example.net');
  await Promise.all([applyPendingRules(r, target, null), applyPendingRules(r, target, null)]);
  expect(await count()).toHaveLength(3);
  const colleague = await mailbox('Colega da mesma empresa');
  await incoming(colleague.email_address);
  await applyPendingRules(r, target, null);
  expect(await count()).toHaveLength(4);
  await call('PATCH', '/rules/' + ruleId, { is_active: false });
  const pending = (await count()).find(
    (o) => o.created_by_rule_id === ruleId && o.status === 'queued',
  )!;
  await expect(
    handleOutboxSend(r, pending.id, {
      id: pending.job_id!,
      attemptsMade: 0,
      opts: { attempts: 1 },
    }),
  ).rejects.toThrow();
  expect(
    (
      await db
        .selectFrom('outbox')
        .select('status')
        .where('id', '=', pending.id)
        .executeTakeFirstOrThrow()
    ).status,
  ).toBe('failed');
}, 30000);
