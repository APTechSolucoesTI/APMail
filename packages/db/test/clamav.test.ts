import { createServer, type Socket } from 'node:net';
import { Readable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import { probeClamAv, scanClamAv, type ClamAvOptions } from '../src/security/clamav.js';

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

type FakeOptions = {
  ping?: string;
  version?: string;
  scan?: string;
  fragment?: boolean;
  scanReply?: (socket: Socket) => void;
  scanConnected?: (socket: Socket) => void;
};
async function fakeClamd(settings: FakeOptions = {}) {
  const commands: string[] = [];
  const payloads: Buffer[] = [];
  const frames: number[] = [];
  const sockets = new Set<Socket>();
  const reply = (socket: Socket, value: string) => {
    if (!settings.fragment) return socket.end(value);
    socket.write(value.slice(0, 2));
    setImmediate(() => {
      if (!socket.destroyed) socket.end(value.slice(2));
    });
  };
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    let pending = Buffer.alloc(0);
    let command: string | undefined;
    let needed: number | undefined;
    socket.on('data', (chunk: Buffer) => {
      pending = Buffer.concat([pending, chunk]);
      if (!command) {
        const end = pending.indexOf(0);
        if (end < 0) return;
        command = pending.subarray(0, end).toString();
        pending = pending.subarray(end + 1);
        commands.push(command);
        if (command === 'zPING') return reply(socket, settings.ping ?? 'PONG\0');
        if (command === 'zVERSION')
          return reply(
            socket,
            settings.version ?? `ClamAV 1.5.4/27890/${new Date().toUTCString()}\0`,
          );
        if (command !== 'zINSTREAM') return socket.destroy();
        settings.scanConnected?.(socket);
      }
      while (pending.length >= (needed ?? 4)) {
        if (needed === undefined) {
          needed = pending.readUInt32BE();
          pending = pending.subarray(4);
          frames.push(needed);
          if (needed === 0) {
            if (settings.scanReply) settings.scanReply(socket);
            else reply(socket, settings.scan ?? 'stream: OK\0');
            return;
          }
        }
        if (pending.length < needed) return;
        payloads.push(Buffer.from(pending.subarray(0, needed)));
        pending = pending.subarray(needed);
        needed = undefined;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('TCP listener unavailable');
  const options: ClamAvOptions = {
    host: '127.0.0.1',
    port: address.port,
    maxBytes: 25 * 1024 * 1024,
    timeoutMs: 3000,
    connectTimeoutMs: 1000,
    definitionsMaxAgeHours: 168,
  };
  return { options, commands, frames, payloads };
}

describe('ClamAV health', () => {
  it('uses framed PING and VERSION and parses the real engine and signature date', async () => {
    const daemon = await fakeClamd({ fragment: true });
    const health = await probeClamAv(daemon.options);
    expect(health).toMatchObject({
      status: 'online',
      engine_version: '1.5.4',
      signature_version: '27890',
      error_code: null,
    });
    expect(Number.isFinite(Date.parse(health.definitions_at!))).toBe(true);
    expect(daemon.commands).toEqual(['zPING', 'zVERSION']);
  });

  it.each([
    ['ClamAV 1.5.4/27890/Mon Oct 26 12:03:45 2020\0', 'definitions_stale'],
    ['ClamAV 1.5.4/27890/not-a-date\0', 'definitions_invalid'],
    ['ClamAV 1.5.4/27890/Fri Feb 31 12:03:45 2026\0', 'definitions_invalid'],
    ['ClamAV 1.5.4/27890/Mon Oct 26 12:03:45 2099\0', 'definitions_invalid'],
    ['COMMAND UNAVAILABLE\0', 'version_invalid'],
  ])('does not report healthy definitions for %s', async (version, errorCode) => {
    const daemon = await fakeClamd({ version });
    expect(await probeClamAv(daemon.options)).toMatchObject({
      status: 'error',
      error_code: errorCode,
    });
  });

  it('parses the ctime date emitted by clamd as UTC', async () => {
    const daemon = await fakeClamd({ version: 'ClamAV 1.5.4/27890/Mon Oct 26 12:03:45 2026\0' });
    const result = await probeClamAv({ ...daemon.options, definitionsMaxAgeHours: 24 * 365 * 100 });
    expect(result.definitions_at).toBe('2026-10-26T12:03:45.000Z');
  });

  it.each(['PONG', 'not-PONG\0'])(
    'rejects invalid PONG %j before asking for a version',
    async (ping) => {
      const daemon = await fakeClamd({ ping });
      expect(await probeClamAv(daemon.options)).toMatchObject({ status: 'error' });
      expect(daemon.commands).toEqual(['zPING']);
    },
  );

  it('returns unavailable for invalid options without opening a socket', async () => {
    const daemon = await fakeClamd();
    expect(await probeClamAv({ ...daemon.options, port: 0 })).toMatchObject({
      status: 'unavailable',
      error_code: 'configuration_invalid',
    });
    expect(daemon.commands).toEqual([]);
  });

  it('reports a refused connection as offline and destroys the unscanned source', async () => {
    const unused = createServer();
    await new Promise<void>((resolve) => unused.listen(0, '127.0.0.1', resolve));
    const address = unused.address();
    if (!address || typeof address === 'string') throw new Error('TCP listener unavailable');
    await new Promise<void>((resolve) => unused.close(() => resolve()));
    const daemon = await fakeClamd();
    const options = { ...daemon.options, port: address.port };
    expect(await probeClamAv(options)).toMatchObject({
      status: 'offline',
      error_code: 'connection_failed',
    });
    const source = Readable.from(['abc']);
    expect(await scanClamAv(source, options)).toMatchObject({
      status: 'error',
      error_code: 'connection_failed',
    });
    expect(source.destroyed).toBe(true);
  });
});

describe('ClamAV INSTREAM', () => {
  it('frames binary data, finishes with a zero length and hashes the complete original bytes', async () => {
    const daemon = await fakeClamd({ fragment: true });
    const result = await scanClamAv(
      Readable.from([Buffer.from('a'), Buffer.from('bc')]),
      daemon.options,
    );
    expect(result).toMatchObject({
      status: 'clean',
      size_bytes: 3,
      sha256: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
      threat_name: null,
      error_code: null,
      engine_version: '1.5.4',
      signature_version: '27890',
    });
    expect(Buffer.concat(daemon.payloads)).toEqual(Buffer.from('abc'));
    expect(daemon.frames.at(-1)).toBe(0);
    expect(daemon.commands).toEqual(['zPING', 'zVERSION', 'zINSTREAM']);
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('scans an empty file and includes its SHA256', async () => {
    const daemon = await fakeClamd();
    expect(await scanClamAv(Readable.from([]), daemon.options)).toMatchObject({
      status: 'clean',
      size_bytes: 0,
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    });
    expect(daemon.frames).toEqual([0]);
  });

  it('preserves NUL, non-UTF8 and newline bytes in the scan payload', async () => {
    const daemon = await fakeClamd();
    const bytes = Buffer.from([0, 255, 128, 13, 10]);
    expect((await scanClamAv(Readable.from([bytes]), daemon.options)).status).toBe('clean');
    expect(Buffer.concat(daemon.payloads)).toEqual(bytes);
  });

  it.each([
    ['stream: Win.Test.Eicar_HDB-1 FOUND\0', 'Win.Test.Eicar_HDB-1'],
    ['stream: Heuristics.Encrypted.Zip FOUND\0', 'Heuristics.Encrypted.Zip'],
    [
      'stream: Heuristics.Limits.Exceeded.MaxScanSize FOUND\0',
      'Heuristics.Limits.Exceeded.MaxScanSize',
    ],
  ])('preserves detection %s instead of accepting it as clean', async (scan, threatName) => {
    const daemon = await fakeClamd({ scan });
    expect(await scanClamAv(Readable.from(['abc']), daemon.options)).toMatchObject({
      status: 'infected',
      threat_name: threatName,
      error_code: null,
    });
  });

  it.each([
    'stream: OK',
    'stream: OK\n',
    'stream: OK \0',
    'other: OK\0',
    'stream: NOT OK\0',
    'stream: Access denied ERROR\0',
    'INSTREAM size limit exceeded. ERROR\0',
    'stream: OK\0stream: Malware FOUND\0',
    'stream: OK\0extra',
    '',
  ])('fails closed for ambiguous, truncated, or failing reply %j', async (scan) => {
    const daemon = await fakeClamd({ scan });
    const result = await scanClamAv(Readable.from(['abc']), daemon.options);
    expect(result.status).toBe('error');
    expect(result.error_code).toBeTruthy();
  });

  it('bounds the reply before buffering an arbitrary amount from the daemon', async () => {
    const daemon = await fakeClamd({ scan: 'x'.repeat(20_000) + '\0' });
    expect(await scanClamAv(Readable.from(['abc']), daemon.options)).toMatchObject({
      status: 'error',
      error_code: 'response_too_large',
    });
  });

  it('waits until close so a later contradictory response cannot pass as clean', async () => {
    const daemon = await fakeClamd({
      scanReply(socket) {
        socket.write('stream: OK\0');
        setTimeout(() => socket.end('stream: Malware FOUND\0'), 20);
      },
    });
    expect((await scanClamAv(Readable.from(['abc']), daemon.options)).status).toBe('error');
  });

  it('rejects an unsolicited clean reply before consuming the entire source', async () => {
    const daemon = await fakeClamd({ scanConnected: (socket) => socket.end('stream: OK\0') });
    const source = new Readable({ read() {} });
    source.push(Buffer.from('abc'));
    const result = await scanClamAv(source, daemon.options);
    expect(result.status).toBe('error');
    expect(source.destroyed).toBe(true);
  });

  it('stops streaming before an oversized chunk and never publishes a partial hash as complete', async () => {
    const daemon = await fakeClamd();
    const source = Readable.from([Buffer.from('abc'), Buffer.from('d')]);
    expect(await scanClamAv(source, { ...daemon.options, maxBytes: 3 })).toMatchObject({
      status: 'error',
      error_code: 'size_limit',
      sha256: null,
    });
    expect(Buffer.concat(daemon.payloads).length).toBeLessThanOrEqual(3);
    expect(daemon.frames).not.toContain(0);
    expect(source.destroyed).toBe(true);
  });

  it('accepts a file exactly at the configured size limit', async () => {
    const daemon = await fakeClamd();
    expect(
      (await scanClamAv(Readable.from(['abc']), { ...daemon.options, maxBytes: 3 })).status,
    ).toBe('clean');
  });

  it('returns an error when the source fails during upload', async () => {
    const daemon = await fakeClamd();
    const source = Readable.from(
      (async function* () {
        yield Buffer.from('abc');
        throw new Error('private filesystem error');
      })(),
    );
    const result = await scanClamAv(source, daemon.options);
    expect(result).toMatchObject({ status: 'error', error_code: 'source_error', sha256: null });
    expect(JSON.stringify(result)).not.toContain('private filesystem');
  });

  it('times out an unresponsive scan and destroys a stalled source', async () => {
    const daemon = await fakeClamd({ scanReply() {} });
    const result = await scanClamAv(Readable.from(['abc']), { ...daemon.options, timeoutMs: 100 });
    expect(result).toMatchObject({ status: 'error', error_code: 'timeout' });
    const source = new Readable({ read() {} });
    const stalled = await scanClamAv(source, { ...daemon.options, timeoutMs: 100 });
    expect(stalled).toMatchObject({ status: 'error', error_code: 'timeout' });
    expect(source.destroyed).toBe(true);
  });

  it('does not start INSTREAM when the probe reports stale definitions', async () => {
    const daemon = await fakeClamd({ version: 'ClamAV 1.5.4/27890/Mon Oct 26 12:03:45 2020\0' });
    const source = Readable.from(['abc']);
    expect(await scanClamAv(source, daemon.options)).toMatchObject({
      status: 'error',
      error_code: 'definitions_stale',
      sha256: null,
    });
    expect(daemon.commands).toEqual(['zPING', 'zVERSION']);
    expect(source.destroyed).toBe(true);
  });

  it('contains asynchronous source errors emitted while closing after a probe failure', async () => {
    const daemon = await fakeClamd({ ping: 'not-PONG\0' });
    let closed = false;
    const source = new Readable({
      read() {},
      destroy(_error, callback) {
        setImmediate(() => {
          closed = true;
          callback(new Error('private close error'));
        });
      },
    });
    expect((await scanClamAv(source, daemon.options)).status).toBe('error');
    await new Promise<void>((resolve) => source.once('close', resolve));
    expect(closed).toBe(true);
  });

  it('streams a large source through bounded frames while the receiver applies backpressure', async () => {
    let sent = 0;
    let observedBeforeResume = 0;
    const chunks = 512;
    const daemon = await fakeClamd({
      scanConnected(socket) {
        socket.pause();
        setTimeout(() => {
          observedBeforeResume = sent;
          socket.resume();
        }, 50);
      },
    });
    const source = Readable.from(
      (async function* () {
        for (let index = 0; index < chunks; index++) {
          sent++;
          yield Buffer.alloc(64 * 1024, index % 251);
        }
      })(),
    );
    const result = await scanClamAv(source, { ...daemon.options, maxBytes: 64 * 1024 * chunks });
    expect(result.status).toBe('clean');
    expect(result.size_bytes).toBe(64 * 1024 * chunks);
    expect(observedBeforeResume).toBeLessThan(chunks);
    expect(Math.max(...daemon.frames)).toBeLessThanOrEqual(64 * 1024);
    expect(daemon.payloads.reduce((size, chunk) => size + chunk.length, 0)).toBe(result.size_bytes);
  });
});
