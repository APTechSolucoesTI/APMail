import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { mailboxSchema } from '@apmail/shared';
import type { z } from 'zod';
import type { ApiEnv } from '../env.js';
import { ApiError } from '../authz/context.js';

export const connectionSchema = mailboxSchema.pick({
  username: true,
  password: true,
  imap_host: true,
  imap_port: true,
  imap_secure: true,
  smtp_host: true,
  smtp_port: true,
  smtp_secure: true,
});
type Connection = z.infer<typeof connectionSchema>;

// A mesma política TLS do worker: exceções somente no ambiente de desenvolvimento.
export async function assertMailboxConnection(env: ApiEnv, b: Connection) {
  const insecure = (host: string) =>
    env.NODE_ENV === 'development' &&
    env.ALLOW_INSECURE_TLS_HOSTS.split(',')
      .map((value) => value.trim().toLowerCase())
      .includes(host.toLowerCase());
  const imap = new ImapFlow({
    host: b.imap_host,
    port: b.imap_port,
    secure: b.imap_secure,
    auth: { user: b.username, pass: b.password },
    logger: false,
    disableAutoIdle: true,
    tls: insecure(b.imap_host) ? { rejectUnauthorized: false } : undefined,
    doSTARTTLS: !b.imap_secure && !insecure(b.imap_host) ? true : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  imap.on('error', () => undefined);
  const smtp = nodemailer.createTransport({
    host: b.smtp_host,
    port: b.smtp_port,
    secure: b.smtp_secure,
    auth: { user: b.username, pass: b.password },
    requireTLS: !b.smtp_secure && !insecure(b.smtp_host),
    tls: insecure(b.smtp_host) ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
  const results = await Promise.allSettled([
    (async () => {
      try {
        await imap.connect();
      } finally {
        imap.close();
      }
    })(),
    (async () => {
      try {
        await smtp.verify();
      } finally {
        smtp.close();
      }
    })(),
  ]);
  const failed = results.flatMap((result, index) =>
    result.status === 'rejected' ? [index === 0 ? 'IMAP' : 'SMTP'] : [],
  );
  if (failed.length)
    throw new ApiError(
      422,
      'connection_failed',
      `Não foi possível autenticar a conexão ${failed.join(' e ')}. Confira servidor, porta, TLS, usuário e senha. A caixa não foi salva.`,
    );
  return { imap: true, smtp: true };
}
