import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { createServer, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { Emitter } from '@socket.io/redis-emitter';
import pino from 'pino';
import { simpleParser } from 'mailparser';
import { sql } from 'kysely';
import {
  createDb,
  createQueues,
  migrate,
  ensureLocalFolders,
  writeMailboxCredential,
  Storage,
  asJson,
  encryptSecret,
} from '@apmail/db';
import { socketRedisKey } from '@apmail/shared';
import { envSchema } from '../../src/env.js';
import { handleOutboxSend } from '../../src/handlers/outbox-send.js';
import { handleIntegrationWebhook } from '../../src/handlers/integration-webhooks.js';

const url = process.env.DATABASE_URL_TEST!,
  redisUrl = process.env.REDIS_URL_TEST!;
if (
  !url ||
  !new URL(url).pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1'].includes(new URL(url).hostname)
)
  throw Error('Dedicated local test database required');
if (
  !redisUrl ||
  !['localhost', '127.0.0.1'].includes(new URL(redisUrl).hostname) ||
  new URL(redisUrl).pathname !== '/9'
)
  throw Error('Dedicated local Redis /9 required');
const db = createDb(url),
  redis = new Redis(redisUrl, { maxRetriesPerRequest: null }),
  queues = createQueues(redisUrl);
const tenant = randomUUID(),
  owner = randomUUID(),
  guest = randomUUID(),
  boxId = randomUUID();
const mailboxAddress = boxId + '@delegated.test',
  customerAddress = 'customer@delegated.test';
const key = randomBytes(32).toString('base64'),
  storagePath = join(tmpdir(), 'apmail-delegated-send-' + tenant);
const r = {
  db,
  redis,
  queues: queues.queues,
  storage: new Storage(storagePath, db),
  log: pino({ level: 'silent' }),
  io: new Emitter(redis, { key: socketRedisKey(redisUrl) }),
  env: envSchema.parse({
    NODE_ENV: 'development',
    DATABASE_URL: url,
    REDIS_URL: redisUrl,
    APP_URL: 'http://localhost:5173',
    SMTP_EHLO_NAME: 'app.apmail.com.br',
    SESSION_SECRET: key,
    CREDENTIALS_ENCRYPTION_KEY: key,
    STORAGE_DIR: storagePath,
    ALLOW_INSECURE_TLS_HOSTS: '127.0.0.1,localhost',
  }),
};
const deliveries: { raw: Buffer; from: string; to: string[] }[] = [],
  connections = new Set<Socket>();
let smtpConnections = 0;
// This local server exercises actual Nodemailer SMTP and records only fixture mail.
const smtp = createServer((socket) => {
  ++smtpConnections;
  connections.add(socket);
  socket.on('close', () => connections.delete(socket));
  socket.write('220 localhost QA SMTP\r\n');
  let buffered = '',
    data = false,
    from = '',
    to: string[] = [],
    lines: string[] = [];
  socket.on('data', (chunk) => {
    buffered += chunk.toString();
    let end: number;
    while ((end = buffered.indexOf('\r\n')) >= 0) {
      const line = buffered.slice(0, end);
      buffered = buffered.slice(end + 2);
      if (data) {
        if (line === '.') {
          deliveries.push({ raw: Buffer.from(lines.join('\r\n') + '\r\n'), from, to: [...to] });
          data = false;
          lines = [];
          socket.write('250 accepted\r\n');
        } else lines.push(line.replace(/^\.\./, '.'));
      } else if (/^(?:EHLO|HELO) /i.test(line)) socket.write('250-localhost\r\n250 AUTH PLAIN\r\n');
      else if (/^AUTH /i.test(line)) socket.write('235 authenticated\r\n');
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
      } else if (/^QUIT$/i.test(line)) socket.end('221 bye\r\n');
      else socket.write('250 ok\r\n');
    }
  });
});
let inboxId: string;
beforeAll(async () => {
  await migrate(url);
  await new Promise<void>((resolve) => smtp.listen(0, '127.0.0.1', resolve));
  const port = (smtp.address() as { port: number }).port;
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('tenants')
      .values({ id: tenant, name: 'Delegated send QA', slug: tenant })
      .execute();
    await tx
      .insertInto('users')
      .values(
        [owner, guest].map((id) => ({
          id,
          email: id + '@delegated.test',
          full_name: id === owner ? 'Owner QA' : 'Guest QA',
          password_hash: 'fixture',
        })),
      )
      .execute();
    const profile = await tx
      .insertInto('access_profiles')
      .values({
        tenant_id: tenant,
        name: 'Operational sender QA',
        permissions: ['mail', 'mail.send', 'mail.organize'],
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await tx
      .insertInto('tenant_members')
      .values(
        [owner, guest].map((user_id) => ({
          tenant_id: tenant,
          user_id,
          role: 'member' as const,
          access_profile_id: profile.id,
        })),
      )
      .execute();
    await tx
      .insertInto('mailboxes')
      .values({
        id: boxId,
        tenant_id: tenant,
        name: 'Individual',
        email_address: mailboxAddress,
        username: 'qa',
        imap_host: '127.0.0.1',
        smtp_host: '127.0.0.1',
        smtp_port: port,
        smtp_secure: false,
        receiving_protocol: 'pop3',
        append_sent_copy: false,
        status: 'active',
        box_type: 'individual',
        owner_user_id: owner,
        queues_enabled: false,
      })
      .execute();
    await tx
      .insertInto('mailbox_members')
      .values({ tenant_id: tenant, mailbox_id: boxId, user_id: owner, role: 'editor' })
      .execute();
    inboxId = (await ensureLocalFolders(tx, tenant, boxId)).id;
    await writeMailboxCredential(tx, tenant, boxId, 'local-fixture', key);
  });
}, 30000);
afterAll(async () => {
  for (const socket of connections) socket.destroy();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
  await queues.close();
  await redis.quit();
  await db.destroy();
});
async function queuedReply() {
  const thread = randomUUID(),
    message = randomUUID(),
    invitation = randomUUID(),
    jobId = randomUUID();
  const inboundAt = new Date(Date.now() - 60000),
    sourceHeader = '<' + message + '@delegated.test>';
  await db.transaction().execute(async (tx) => {
    await tx
      .insertInto('threads')
      .values({
        id: thread,
        tenant_id: tenant,
        mailbox_id: boxId,
        subject: 'Delegated service',
        subject_normalized: 'delegated service',
        assigned_to: owner,
        assigned_at: inboundAt,
        last_inbound_at: inboundAt,
        service_started_at: new Date(),
        queue_status: 'in_progress',
      })
      .execute();
    await tx
      .insertInto('messages')
      .values({
        id: message,
        tenant_id: tenant,
        mailbox_id: boxId,
        thread_id: thread,
        folder_id: inboxId,
        message_at: inboundAt,
        message_id_header: sourceHeader,
        direction: 'inbound',
        from_address: customerAddress,
        to_addresses: asJson([{ address: mailboxAddress, name: 'Original mailbox' }]),
        subject: 'Delegated service',
        body_text: 'Please help',
      })
      .execute();
    await sql`insert into thread_service_invitations(id,tenant_id,mailbox_id,thread_id,inviter_id,invitee_id) values(${invitation}::uuid,${tenant}::uuid,${boxId}::uuid,${thread}::uuid,${owner}::uuid,${guest}::uuid)`.execute(
      tx,
    );
  });
  const outbox = await db
    .insertInto('outbox')
    .values({
      tenant_id: tenant,
      mailbox_id: boxId,
      thread_id: thread,
      source_thread_id: thread,
      reply_to_message_id: message,
      created_by: guest,
      kind: 'reply',
      status: 'queued',
      job_id: jobId,
      send_after: new Date(0),
      subject: 'Re: Delegated service',
      body_html: '<p>Reply from invited colleague.</p>',
      to_addresses: asJson([{ address: customerAddress, name: 'Customer' }]),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return {
    thread,
    message,
    invitation,
    sourceHeader,
    outbox: outbox.id,
    job: { id: jobId, attemptsMade: 0, opts: { attempts: 1 } },
  };
}
it('an invited colleague without mailbox membership sends through the original mailbox and preserves service ownership', async () => {
  const f = await queuedReply(),
    before = deliveries.length;
  const secret = randomBytes(32).toString('base64url');
  const webhook = await db
    .insertInto('integration_webhooks')
    .values({
      tenant_id: tenant,
      name: 'QA enviados',
      url: 'https://example.com/apmail',
      enabled: true,
      event: 'email.sent',
      events: ['email.sent'],
      created_by: owner,
      encrypted_secret: encryptSecret(secret, key),
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('integration_webhook_mailboxes')
    .values({ tenant_id: tenant, mailbox_id: boxId, webhook_id: webhook.id })
    .execute();
  expect(
    await db
      .selectFrom('mailbox_members')
      .select('id')
      .where('mailbox_id', '=', boxId)
      .where('user_id', '=', guest)
      .executeTakeFirst(),
  ).toBeUndefined();
  await handleOutboxSend(r, f.outbox, f.job);
  expect(deliveries).toHaveLength(before + 1);
  const delivered = deliveries.at(-1)!;
  expect(delivered.from).toBe('<' + mailboxAddress + '>');
  expect(delivered.to).toEqual(['<' + customerAddress + '>']);
  const mime = await simpleParser(delivered.raw);
  expect(mime.from?.value[0]?.address).toBe(mailboxAddress);
  expect(mime.inReplyTo).toBe(f.sourceHeader);
  const outbox = await db
    .selectFrom('outbox')
    .selectAll()
    .where('id', '=', f.outbox)
    .executeTakeFirstOrThrow();
  expect(outbox.status, outbox.last_error ?? '').toBe('sent');
  expect(outbox.thread_id).toBe(f.thread);
  const sent = await db
    .selectFrom('messages')
    .selectAll()
    .where('id', '=', outbox.sent_message_id!)
    .executeTakeFirstOrThrow();
  expect(sent.thread_id).toBe(f.thread);
  expect(sent.sent_by_user_id).toBe(guest);
  expect(sent.from_address).toBe(mailboxAddress);
  const event = await db
    .selectFrom('integration_message_events')
    .select(['id', 'sequence'])
    .where('message_id', '=', sent.id)
    .executeTakeFirstOrThrow();
  const inboundEvent = await db
    .selectFrom('integration_message_events')
    .select('sequence')
    .where('message_id', '=', f.message)
    .executeTakeFirstOrThrow();
  expect(BigInt(event.sequence)).toBeGreaterThan(BigInt(inboundEvent.sequence));
  const delivery = await db
    .selectFrom('integration_webhook_deliveries')
    .select(['id', 'event_key'])
    .where('webhook_id', '=', webhook.id)
    .where('event_id', '=', event.id)
    .where('event_type', '=', 'email.sent')
    .executeTakeFirstOrThrow();
  await handleIntegrationWebhook(r, delivery.id, async (_url, body, headers) => {
    expect(JSON.parse(body)).toMatchObject({
      event: 'email.sent',
      eventId: delivery.event_key,
      test: false,
      data: { id: sent.id, threadId: f.thread, direction: 'outbound', sentByUser: { id: guest } },
    });
    expect(headers['X-APMail-Signature']).toBe(
      'sha256=' +
        createHmac('sha256', secret)
          .update(headers['X-APMail-Timestamp'] + '.' + body)
          .digest('hex'),
    );
    return 204;
  });
  expect(
    (
      await db
        .selectFrom('integration_webhook_deliveries')
        .select('state')
        .where('id', '=', delivery.id)
        .executeTakeFirstOrThrow()
    ).state,
  ).toBe('delivered');
  const thread = await db
    .selectFrom('threads')
    .selectAll()
    .where('id', '=', f.thread)
    .executeTakeFirstOrThrow();
  expect(thread.assigned_to).toBe(owner);
  expect(thread.queue_status).toBe('awaiting_reply');
  expect(thread.service_started_at).toBeNull();
});
it.each(['completed', 'revoked', 'conversation_completed'] as const)(
  'queued reply fails before SMTP after invitation access ends: %s',
  async (state) => {
    const f = await queuedReply(),
      before = deliveries.length,
      connectionsBefore = smtpConnections;
    if (state === 'conversation_completed')
      await db
        .updateTable('threads')
        .set({ manual_done_at: new Date(), queue_status: 'done' })
        .where('id', '=', f.thread)
        .execute();
    else
      await sql`update thread_service_invitations set state=${state},closed_at=now(),closed_by=${owner}::uuid where id=${f.invitation}::uuid`.execute(
        db,
      );
    await expect(handleOutboxSend(r, f.outbox, f.job)).rejects.toThrow(
      'O acesso de envio foi removido.',
    );
    expect(deliveries).toHaveLength(before);
    expect(smtpConnections).toBe(connectionsBefore);
    const outbox = await db
      .selectFrom('outbox')
      .select(['status', 'sent_message_id', 'last_error'])
      .where('id', '=', f.outbox)
      .executeTakeFirstOrThrow();
    expect(outbox.status).toBe('failed');
    expect(outbox.sent_message_id).toBeNull();
    expect(outbox.last_error).toBe('O acesso de envio foi removido.');
    expect(
      await db
        .selectFrom('messages')
        .select('id')
        .where('outbox_id', '=', f.outbox)
        .executeTakeFirst(),
    ).toBeUndefined();
  },
);
