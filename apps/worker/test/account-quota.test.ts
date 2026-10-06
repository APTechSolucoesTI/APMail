import { createServer, type Socket } from 'node:net';
import { ImapFlow, type ImapResponse, type ImapAttribute } from 'imapflow';
import { expect, it, vi } from 'vitest';
import {
  readAccountQuota,
  isAccountQuotaRoot,
  type QuotaConnection,
} from '../src/imap/account-quota.js';

const atom = (value: string): ImapAttribute => ({ type: 'STRING', value });
const reply = (...attributes: ImapAttribute[]): ImapResponse => ({ attributes });
const quotaReply = (root: string, used = '10', limit = '100') =>
  reply(atom(root), [atom('STORAGE'), atom(used), atom(limit)]);
function connection(roots: string[], responses: ImapResponse[] = []) {
  const next = vi.fn();
  const exec: QuotaConnection['exec'] = vi.fn(async (command, args, options) => {
    if (command === 'GETQUOTAROOT') {
      await options.untagged.QUOTAROOT!(reply(atom('INBOX'), ...roots.map(atom)));
      for (const response of responses) await options.untagged.QUOTA!(response);
    } else await options.untagged.QUOTA!(quotaReply(args[0]!.value));
    return { next };
  });
  return { capabilities: new Map([['QUOTA', true]]), exec, next };
}
it('seleciona somente a cota do usuário mesmo com a resposta do domínio por último', async () => {
  for (const roots of [
    ['User quota', 'Domain quota'],
    ['Domain quota', 'User quota'],
  ]) {
    const c = connection(roots, [
      quotaReply('User quota'),
      quotaReply('Domain quota', '900', '1000'),
    ]);
    expect(await readAccountQuota(c, 'suporte@empresa.local', 'mail.empresa.local')).toEqual({
      root: 'User quota',
      used: '10240',
      limit: '102400',
    });
    expect(c.exec).toHaveBeenCalledTimes(1);
    expect(c.next).toHaveBeenCalledOnce();
  }
});
it('não transforma quota de domínio, opaca ou ambígua em capacidade individual', async () => {
  expect(isAccountQuotaRoot('user@domain.local', 'user@domain.local', 'mail.domain.local')).toBe(
    true,
  );
  for (const roots of [
    ['Domain quota'],
    ['empresa.local'],
    ['Account quota'],
    ['opaque'],
    [''],
    ['User quota', 'Mailbox quota'],
  ]) {
    const c = connection(
      roots,
      roots.map((root) => quotaReply(root)),
    );
    expect(await readAccountQuota(c, 'suporte@empresa.local', 'mail.empresa.local')).toBeNull();
    expect(c.exec).toHaveBeenCalledTimes(1);
  }
  expect(isAccountQuotaRoot('User domain quota', 'user@empresa.local', 'mail.empresa.local')).toBe(
    false,
  );
});
it('consulta a raiz individual ausente na resposta inline, incluindo raiz vazia conhecida', async () => {
  const c = connection(['']);
  expect(await readAccountQuota(c, 'user@gmail.com', 'imap.gmail.com')).toEqual({
    root: '',
    used: '10240',
    limit: '102400',
  });
  expect(c.exec).toHaveBeenLastCalledWith(
    'GETQUOTA',
    [{ type: 'STRING', value: '' }],
    expect.anything(),
  );
  expect(c.next).toHaveBeenCalledTimes(2);
});
it('preserva bytes acima de Number.MAX_SAFE_INTEGER, zero e recusa payload inválido', async () => {
  const c = connection(['Mailbox quota'], [quotaReply('Mailbox quota', '9007199254740991', '0')]);
  expect(await readAccountQuota(c, 'user', 'mail.local')).toEqual({
    root: 'Mailbox quota',
    used: '9223372036854774784',
    limit: '0',
  });
});
it('ignora recursos inválidos e raízes não anunciadas', async () => {
  for (const value of ['-1', 'Infinity', '1e3', ' 1', '9223372036854775807']) {
    const c = connection(['User quota'], [quotaReply('User quota', value)]);
    // Fallback returns a fresh valid sample, rather than accepting malformed bytes.
    expect(await readAccountQuota(c, 'user', 'mail.local')).toEqual({
      root: 'User quota',
      used: '10240',
      limit: '102400',
    });
    expect(c.exec).toHaveBeenCalledTimes(2);
  }
  const c = connection(['Domain quota'], [quotaReply('User quota')]);
  expect(await readAccountQuota(c, 'user', 'mail.local')).toBeNull();
});
it('não envia comandos quando o servidor não anuncia QUOTA', async () => {
  const c = connection([]);
  c.capabilities.clear();
  expect(await readAccountQuota(c, 'user', 'mail.local')).toBeNull();
  expect(c.exec).not.toHaveBeenCalled();
});
it('interpreta as duas raízes no protocolo real do ImapFlow sem misturar recursos', async () => {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('* PREAUTH [CAPABILITY IMAP4rev1 QUOTA] ready\r\n');
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let end: number;
      while ((end = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const [tag, command] = line.split(' ');
        if (command === 'CAPABILITY') socket.write('* CAPABILITY IMAP4rev1 QUOTA\r\n');
        if (command === 'LIST') socket.write('* LIST (\\Noselect) "/" ""\r\n');
        if (command === 'GETQUOTAROOT')
          socket.write(
            '* QUOTAROOT INBOX "User quota" "Domain quota"\r\n* QUOTA "User quota" (STORAGE 10 100)\r\n* QUOTA "Domain quota" (STORAGE 900 1000)\r\n',
          );
        if (command === 'LOGOUT') socket.write('* BYE goodbye\r\n');
        socket.write(`${tag} OK done\r\n`);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Test server unavailable');
  const imap = new ImapFlow({
    host: '127.0.0.1',
    port: address.port,
    secure: false,
    doSTARTTLS: false,
    logger: false,
    disableAutoIdle: true,
  });
  try {
    await imap.connect();
    expect(await readAccountQuota(imap, 'user@empresa.local', 'mail.empresa.local')).toEqual({
      root: 'User quota',
      used: '10240',
      limit: '102400',
    });
    await imap.noop(); // Both parser callbacks must release the connection.
  } finally {
    imap.close();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
