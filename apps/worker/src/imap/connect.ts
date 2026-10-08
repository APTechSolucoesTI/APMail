import { ImapFlow } from 'imapflow';
import nodemailer from 'nodemailer';
import { readMailboxCredential, type DB } from '@apmail/db';
import type { Kysely, Selectable } from 'kysely';
import type { WorkerEnv } from '../env.js';
export type Mailbox = Selectable<DB['mailboxes']>;
const clients = new Set<ImapFlow>();
export function allowInsecure(host: string, env: WorkerEnv): boolean {
  return (
    env.NODE_ENV === 'development' &&
    env.ALLOW_INSECURE_TLS_HOSTS.split(',')
      .map((s) => s.trim().toLowerCase())
      .includes(host.toLowerCase())
  );
}
export async function transports(db: Kysely<DB>, box: Mailbox, env: WorkerEnv) {
  const pass =
    box.receiving_protocol === 'local'
      ? ''
      : await readMailboxCredential(db, box.tenant_id, box.id, env.CREDENTIALS_ENCRYPTION_KEY);
  const auth = { user: box.username, pass };
  const imap = new ImapFlow({
    host: box.imap_host,
    port: box.imap_port,
    secure: box.imap_secure,
    auth,
    logger: false,
    tls: allowInsecure(box.imap_host, env) ? { rejectUnauthorized: false } : undefined,
    doSTARTTLS: !box.imap_secure && !allowInsecure(box.imap_host, env) ? true : undefined,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 60000,
    disableAutoIdle: true,
  });
  imap.on('error', () => undefined);
  clients.add(imap);
  const smtp = nodemailer.createTransport({
    host: box.smtp_host,
    port: box.smtp_port,
    secure: box.smtp_secure,
    auth,
    requireTLS: !box.smtp_secure && !allowInsecure(box.smtp_host, env),
    tls: allowInsecure(box.smtp_host, env) ? { rejectUnauthorized: false } : undefined,
    connectionTimeout: 20000,
    greetingTimeout: 20000,
    socketTimeout: 20000,
  });
  return {
    imap,
    smtp,
    async close() {
      // GreenMail 2.1.0 mantém listeners de pasta após LOGOUT; CLOSE evita
      // uma falha do servidor ao excluir pastas em testes de UIDVALIDITY.
      if (allowInsecure(box.imap_host, env) && imap.mailbox)
        await imap.mailboxClose().catch(() => undefined);
      await imap.logout().catch(() => imap.close());
      clients.delete(imap);
      smtp.close();
    },
  };
}
export function closeImapConnections() {
  for (const client of clients) client.close();
  clients.clear();
}
