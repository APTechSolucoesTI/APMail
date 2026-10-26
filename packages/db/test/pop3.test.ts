import { createServer } from 'node:net';
import { expect, it } from 'vitest';
import { Pop3Client } from '../src/pop3.js';
it('authenticates, reads UIDL and preserves binary MIME with dot unstuffing without deleting mail', async () => {
  const commands: string[] = [];
  const server = createServer((socket) => {
    socket.write('+OK ready\r\n');
    let text = '';
    socket.on('data', (chunk) => {
      text += chunk.toString();
      let end: number;
      while ((end = text.indexOf('\r\n')) >= 0) {
        const cmd = text.slice(0, end);
        text = text.slice(end + 2);
        commands.push(cmd);
        if (cmd === 'UIDL') socket.write('+OK\r\n1 stable-one\r\n.\r\n');
        else if (cmd === 'LIST') socket.write('+OK\r\n1 100\r\n.\r\n');
        else if (cmd === 'RETR 1') {
          socket.write('+OK\r\nSubject: Test\r\n\r\n..dot\r\n');
          socket.write(Buffer.from([0xe9, 13, 10]));
          socket.write('.\r\n');
        } else if (cmd === 'QUIT') {
          socket.end('+OK\r\n');
        } else socket.write('+OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  const client = new Pop3Client({
    host: '127.0.0.1',
    port,
    secure: false,
    username: 'qa',
    password: 'secret',
    allowInsecure: true,
  });
  try {
    await client.connect();
    expect(await client.list()).toEqual([{ number: 1, uid: 'stable-one', size: 100 }]);
    const raw = await client.retrieve(1);
    expect(raw.includes(Buffer.from('.dot\r\n'))).toBe(true);
    expect(raw.includes(Buffer.from([0xe9, 13, 10]))).toBe(true);
    await client.quit();
    expect(commands.some((c) => c.startsWith('DELE'))).toBe(false);
  } finally {
    client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it('rejects command injection before opening a connection', async () => {
  const client = new Pop3Client({
    host: 'localhost',
    port: 110,
    secure: false,
    username: 'qa\r\nDELE 1',
    password: 'x',
  });
  await expect(client.connect()).rejects.toThrow('Credenciais');
});
it('identifies rejected credentials without exposing the server response or password', async () => {
  const server = createServer((socket) => {
    socket.write('+OK ready\r\n');
    let input = '';
    socket.on('data', (chunk) => {
      input += chunk.toString();
      let end: number;
      while ((end = input.indexOf('\r\n')) >= 0) {
        const line = input.slice(0, end);
        input = input.slice(end + 2);
        socket.write(line.startsWith('PASS ') ? '-ERR rejected\r\n' : '+OK\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('QA port');
  const client = new Pop3Client({
    host: '127.0.0.1',
    port: address.port,
    secure: false,
    username: 'qa',
    password: 'test-only',
    allowInsecure: true,
  });
  try {
    await expect(client.connect()).rejects.toMatchObject({
      code: 'EAUTH',
      authenticationFailed: true,
      message: 'Falha na autenticação POP3.',
    });
  } finally {
    client.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
