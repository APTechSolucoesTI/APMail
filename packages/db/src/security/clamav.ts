import { createHash } from 'node:crypto';
import { Socket } from 'node:net';
import type { Readable } from 'node:stream';

export type ClamAvOptions = {
  host: string;
  port: number;
  maxBytes: number;
  timeoutMs: number;
  connectTimeoutMs: number;
  definitionsMaxAgeHours: number;
};

export type ClamAvHealth = {
  status: 'online' | 'offline' | 'error' | 'unavailable';
  engine_version: string | null;
  signature_version: string | null;
  definitions_at: string | null;
  checked_at: string;
  error_code: string | null;
};

export type ClamAvScanResult = {
  status: 'clean' | 'infected' | 'error';
  sha256: string | null;
  size_bytes: number;
  threat_name: string | null;
  error_code: string | null;
  engine_version: string | null;
  signature_version: string | null;
  definitions_at: string | null;
  duration_ms: number;
};

const MAX_REPLY_BYTES = 4096;
const FRAME_BYTES = 64 * 1024;
const MAX_TIMER_MS = 2_147_483_647;

class ClamAvFailure extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

function validOptions(options: ClamAvOptions) {
  return (
    typeof options.host === 'string' &&
    options.host.length > 0 &&
    options.host.length <= 253 &&
    !/[\s\0]/.test(options.host) &&
    Number.isInteger(options.port) &&
    options.port >= 1 &&
    options.port <= 65535 &&
    Number.isSafeInteger(options.maxBytes) &&
    options.maxBytes > 0 &&
    Number.isInteger(options.timeoutMs) &&
    options.timeoutMs > 0 &&
    options.timeoutMs <= MAX_TIMER_MS &&
    Number.isInteger(options.connectTimeoutMs) &&
    options.connectTimeoutMs > 0 &&
    options.connectTimeoutMs <= MAX_TIMER_MS &&
    Number.isFinite(options.definitionsMaxAgeHours) &&
    options.definitionsMaxAgeHours > 0
  );
}

function failureCode(error: unknown) {
  return error instanceof ClamAvFailure ? error.code : 'connection_failed';
}

// Waiting for each write callback bounds the outbound queue. A large source chunk
// is split into small frames before it is written, rather than buffered in full.
function write(socket: Socket, bytes: Buffer) {
  return new Promise<void>((resolve, reject) => {
    socket.write(bytes, (error?: Error | null) => (error ? reject(error) : resolve()));
  });
}

/** One NUL-framed command per connection. Read through EOF, not merely the first
 * terminator: extra, contradictory records must never hide behind an initial OK. */
function exchange(
  options: ClamAvOptions,
  deadline: number,
  command: 'PING' | 'VERSION' | 'INSTREAM',
  upload?: (socket: Socket) => Promise<void>,
  abortUpload?: () => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
      abortUpload?.();
      reject(new ClamAvFailure('timeout'));
      return;
    }
    const socket = new Socket();
    let settled = false;
    let connected = false;
    let sent = false;
    let bytes = 0;
    const chunks: Buffer[] = [];
    const finish = (error: ClamAvFailure | null, response?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      if (error) abortUpload?.();
      socket.destroy();
      if (error) reject(error);
      else resolve(response!);
    };
    const totalTimer = setTimeout(() => finish(new ClamAvFailure('timeout')), remaining);
    const connectTimer = setTimeout(
      () => finish(new ClamAvFailure('connect_timeout')),
      Math.min(remaining, options.connectTimeoutMs),
    );
    socket.on('error', () => finish(new ClamAvFailure('connection_failed')));
    socket.on('close', () => {
      if (!settled)
        finish(new ClamAvFailure(connected ? 'response_truncated' : 'connection_failed'));
    });
    socket.on('data', (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > MAX_REPLY_BYTES) {
        finish(new ClamAvFailure('response_too_large'));
        return;
      }
      chunks.push(chunk);
    });
    socket.on('end', () => {
      if (settled) return;
      if (!sent) {
        finish(new ClamAvFailure('response_early'));
        return;
      }
      const response = Buffer.concat(chunks, bytes);
      if (!bytes || response.at(-1) !== 0) {
        finish(new ClamAvFailure('response_truncated'));
        return;
      }
      const record = response.subarray(0, -1);
      if (record.includes(0) || record.includes(10) || record.includes(13)) {
        finish(new ClamAvFailure('response_invalid'));
        return;
      }
      finish(null, record.toString('utf8'));
    });
    socket.once('connect', () => {
      connected = true;
      clearTimeout(connectTimer);
      socket.setNoDelay(true);
      void (async () => {
        await write(socket, Buffer.from(`z${command}\0`, 'ascii'));
        if (upload) await upload(socket);
        sent = true;
      })().catch((error: unknown) => {
        finish(
          new ClamAvFailure(error instanceof ClamAvFailure ? error.code : 'connection_failed'),
        );
      });
    });
    socket.connect({ host: options.host, port: options.port });
  });
}

const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** clamd VERSION uses ctime without a timezone; deployment runs UTC. Also accept
 * the explicit GMT form, while rejecting Date.parse's rollover of invalid dates. */
function definitionsDate(text: string): string | null {
  const ctime =
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+([A-Z][a-z]{2})\s+(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})$/.exec(
      text,
    );
  const gmt =
    /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) ([A-Z][a-z]{2}) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/.exec(
      text,
    );
  if (!ctime && !gmt) return null;
  const month = months.indexOf(ctime ? ctime[1]! : gmt![2]!);
  const day = Number(ctime ? ctime[2] : gmt![1]);
  const year = Number(ctime ? ctime[6] : gmt![3]);
  const hour = Number(ctime ? ctime[3] : gmt![4]);
  const minute = Number(ctime ? ctime[4] : gmt![5]);
  const second = Number(ctime ? ctime[5] : gmt![6]);
  if (month < 0 || year < 2000 || hour > 23 || minute > 59 || second > 59) return null;
  const date = new Date(Date.UTC(year, month, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day)
    return null;
  return date.toISOString();
}

export async function probeClamAv(options: ClamAvOptions): Promise<ClamAvHealth> {
  const health: ClamAvHealth = {
    status: 'unavailable',
    engine_version: null,
    signature_version: null,
    definitions_at: null,
    checked_at: new Date().toISOString(),
    error_code: null,
  };
  if (!validOptions(options)) return { ...health, error_code: 'configuration_invalid' };
  const deadline = Date.now() + options.timeoutMs;
  try {
    if ((await exchange(options, deadline, 'PING')) !== 'PONG')
      throw new ClamAvFailure('ping_invalid');
    const version = await exchange(options, deadline, 'VERSION');
    const parsed = /^ClamAV ([\w.+-]+)\/(\d+)\/(.+)$/.exec(version);
    if (!parsed) throw new ClamAvFailure('version_invalid');
    health.engine_version = parsed[1]!;
    health.signature_version = parsed[2]!;
    health.definitions_at = definitionsDate(parsed[3]!);
    if (!health.definitions_at) throw new ClamAvFailure('definitions_invalid');
    const ageMs = Date.now() - Date.parse(health.definitions_at);
    if (ageMs < -5 * 60 * 1000) throw new ClamAvFailure('definitions_invalid');
    if (ageMs > options.definitionsMaxAgeHours * 60 * 60 * 1000)
      throw new ClamAvFailure('definitions_stale');
    return { ...health, status: 'online' };
  } catch (error) {
    const code = failureCode(error);
    return {
      ...health,
      status: ['connection_failed', 'connect_timeout', 'timeout'].includes(code)
        ? 'offline'
        : 'error',
      error_code: code,
    };
  }
}

export async function scanClamAv(
  source: Readable,
  options: ClamAvOptions,
): Promise<ClamAvScanResult> {
  const started = Date.now();
  const deadline = started + options.timeoutMs;
  const result: ClamAvScanResult = {
    status: 'error',
    sha256: null,
    size_bytes: 0,
    threat_name: null,
    error_code: null,
    engine_version: null,
    signature_version: null,
    definitions_at: null,
    duration_ms: 0,
  };
  let sourceFailed = false;
  const onSourceError = () => {
    sourceFailed = true;
  };
  source.on('error', onSourceError);
  try {
    const health = await probeClamAv(options);
    result.engine_version = health.engine_version;
    result.signature_version = health.signature_version;
    result.definitions_at = health.definitions_at;
    if (health.status !== 'online') throw new ClamAvFailure(health.error_code ?? 'probe_failed');
    if (sourceFailed) throw new ClamAvFailure('source_error');
    const hash = createHash('sha256');
    const response = await exchange(
      options,
      deadline,
      'INSTREAM',
      async (socket) => {
        try {
          for await (const value of source) {
            if (socket.destroyed) throw new ClamAvFailure('connection_failed');
            if (!(
              Buffer.isBuffer(value) ||
              value instanceof Uint8Array ||
              typeof value === 'string'
            ))
              throw new ClamAvFailure('source_error');
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            result.size_bytes += chunk.length;
            if (result.size_bytes > options.maxBytes) throw new ClamAvFailure('size_limit');
            hash.update(chunk);
            for (let offset = 0; offset < chunk.length; offset += FRAME_BYTES) {
              const block = chunk.subarray(offset, offset + FRAME_BYTES);
              const header = Buffer.allocUnsafe(4);
              header.writeUInt32BE(block.length);
              await write(socket, header);
              await write(socket, block);
            }
          }
        } catch (error) {
          throw error instanceof ClamAvFailure ? error : new ClamAvFailure('source_error');
        }
        result.sha256 = hash.digest('hex');
        await write(socket, Buffer.alloc(4));
      },
      () => source.destroy(),
    );
    if (sourceFailed) throw new ClamAvFailure('source_error');
    if (response === 'stream: OK') result.status = 'clean';
    else {
      const found = /^stream: (.{1,512}) FOUND$/.exec(response);
      if (
        !found ||
        [...found[1]!].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        )
      )
        throw new ClamAvFailure(response.endsWith(' ERROR') ? 'scan_failed' : 'response_invalid');
      result.status = 'infected';
      result.threat_name = found[1]!;
    }
  } catch (error) {
    result.error_code = failureCode(error);
  } finally {
    if (source.closed) source.removeListener('error', onSourceError);
    else source.once('close', () => source.removeListener('error', onSourceError));
    source.destroy();
    result.duration_ms = Date.now() - started;
  }
  return result;
}
