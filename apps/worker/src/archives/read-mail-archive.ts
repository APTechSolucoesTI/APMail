import { createReadStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import * as yauzl from 'yauzl';
import { MAIL_MESSAGE_MAX_BYTES, MAIL_ARCHIVE_MAX_BYTES, mailArchiveFormat } from '@apmail/shared';

export type ArchiveMessage = { raw: Buffer; folder: string };
export async function* byteLines(
  stream: Readable,
  maxBytes = MAIL_MESSAGE_MAX_BYTES,
): AsyncGenerator<Buffer> {
  let parts: Buffer[] = [],
    size = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    let start = 0;
    while (start < chunk.length) {
      const newline = chunk.indexOf(10, start);
      const end = newline < 0 ? chunk.length : newline + 1;
      const part = chunk.subarray(start, end);
      size += part.length;
      if (size > maxBytes) throw new Error('Uma linha do arquivo excede o limite de leitura.');
      parts.push(part);
      start = end;
      if (newline >= 0) {
        const line = parts.length === 1 ? parts[0]! : Buffer.concat(parts, size);
        parts = [];
        size = 0;
        yield line;
      }
    }
  }
  if (size) yield Buffer.concat(parts, size);
}
async function boundedBuffer(stream: Readable) {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const value of stream) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    total += chunk.length;
    if (total > MAIL_MESSAGE_MAX_BYTES) throw new Error('Uma mensagem excede 50 MiB.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export async function* mboxMessages(
  stream: Readable,
  folder = 'Importados',
): AsyncGenerator<ArchiveMessage> {
  let chunks: Buffer[] = [],
    size = 0,
    started = false;
  for await (const line of byteLines(stream)) {
    if (line.subarray(0, 5).toString('ascii') === 'From ') {
      if (started && size) {
        yield { raw: Buffer.concat(chunks), folder };
        chunks = [];
        size = 0;
      }
      started = true;
      continue;
    }
    if (!started) {
      if (line.toString('ascii').trim()) throw new Error('MBOX sem separador inicial.');
      continue;
    }
    const unquoted = /^>+From /.test(line.toString('latin1')) ? line.subarray(1) : line;
    size += unquoted.length;
    if (size > MAIL_MESSAGE_MAX_BYTES) throw new Error('Uma mensagem MBOX excede 50 MiB.');
    chunks.push(unquoted);
  }
  if (started && size) yield { raw: Buffer.concat(chunks), folder };
}
async function* textMessages(
  stream: Readable,
  format: string,
  folder: string,
): AsyncGenerator<ArchiveMessage> {
  if (format === 'mbox') {
    yield* mboxMessages(stream, folder);
    return;
  }
  let raw = await boundedBuffer(stream);
  if (format === 'emlx') {
    const end = raw.indexOf(10),
      size = Number(raw.subarray(0, end).toString('ascii').trim());
    if (end < 1 || !Number.isSafeInteger(size) || size <= 0 || raw.length < end + 1 + size)
      throw new Error('Arquivo EMLX inválido.');
    raw = raw.subarray(end + 1, end + 1 + size);
  }
  if (!/^[\w-]+:/.test(raw.subarray(0, 1024).toString('latin1')))
    throw new Error('Mensagem sem cabeçalhos MIME válidos.');
  yield { raw, folder };
}
async function* zipMessages(filename: string): AsyncGenerator<ArchiveMessage> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) =>
    yauzl.open(filename, { lazyEntries: true, validateEntrySizes: true }, (error, file) =>
      error || !file ? reject(error ?? new Error('ZIP inválido.')) : resolve(file),
    ),
  );
  let inflated = 0,
    count = 0;
  try {
    for (;;) {
      const entry = await new Promise<yauzl.Entry | null>((resolve, reject) => {
        const onEntry = (entry: yauzl.Entry) => {
            cleanup();
            resolve(entry);
          },
          onEnd = () => {
            cleanup();
            resolve(null);
          },
          onError = (error: Error) => {
            cleanup();
            reject(error);
          };
        const cleanup = () => {
          zip.off('entry', onEntry);
          zip.off('end', onEnd);
          zip.off('error', onError);
        };
        zip.once('entry', onEntry);
        zip.once('end', onEnd);
        zip.once('error', onError);
        zip.readEntry();
      });
      if (!entry) break;
      if (++count > 100000) throw new Error('ZIP excede 100.000 entradas.');
      if (
        entry.fileName.includes('\\') ||
        entry.fileName.startsWith('/') ||
        entry.fileName.split('/').some((p) => p === '..') ||
        ((entry.externalFileAttributes >>> 16) & 0o170000) === 0o120000
      )
        throw new Error('ZIP contém caminho ou link inválido.');
      if (entry.generalPurposeBitFlag & 1)
        throw new Error('ZIP protegido por senha não é suportado.');
      if (entry.fileName.endsWith('/')) continue;
      const format = mailArchiveFormat(entry.fileName);
      if (!format || !['eml', 'emlx', 'mbox'].includes(format)) continue;
      inflated += entry.uncompressedSize;
      if (inflated > MAIL_ARCHIVE_MAX_BYTES) throw new Error('ZIP descompactado excede 20 GiB.');
      const stream = await new Promise<Readable>((resolve, reject) =>
        zip.openReadStream(entry, (error, stream) =>
          error || !stream ? reject(error ?? new Error('Entrada ZIP inválida.')) : resolve(stream),
        ),
      );
      try {
        yield* textMessages(
          stream,
          format,
          dirname(entry.fileName) === '.' ? 'Importados' : dirname(entry.fileName),
        );
      } finally {
        stream.destroy();
      }
    }
  } finally {
    zip.close();
  }
}
async function* pffMessages(filename: string): AsyncGenerator<ArchiveMessage> {
  const script = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/read-pff.py');
  // No shell, no remote resources; the process emits only MIME envelopes over stdout.
  const child = spawn('python3', ['-I', script, filename], {
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let error: Error | undefined;
  child.on('error', (value) => {
    error = value;
  });
  let diagnostics = '';
  child.stderr.on('data', (value: Buffer) => {
    if (diagnostics.length < 2048) diagnostics += value.toString();
  });
  const completed = new Promise<number | null>((resolve) => child.once('close', resolve));
  let timedOut = false;
  const expire = () => {
    timedOut = true;
    child.kill();
  };
  let timeout = setTimeout(expire, 30 * 60 * 1000);
  try {
    // Await each envelope before reading more stdout: at most one encoded message,
    // rather than a readline queue of messages while the database is slower.
    for await (const line of byteLines(
      child.stdout,
      Math.ceil((MAIL_MESSAGE_MAX_BYTES * 4) / 3) + 4096,
    )) {
      clearTimeout(timeout);
      timeout = setTimeout(expire, 30 * 60 * 1000);
      if (line.length > Math.ceil((MAIL_MESSAGE_MAX_BYTES * 4) / 3) + 4096)
        throw new Error('Uma mensagem PST/OST excede 50 MiB.');
      const value = JSON.parse(line.toString('utf8')) as { folder: string; mime: string };
      if (typeof value.mime !== 'string' || typeof value.folder !== 'string')
        throw new Error('Conversão PST/OST inválida.');
      yield { folder: value.folder, raw: Buffer.from(value.mime, 'base64') };
    }
    const code = await completed;
    if (error || code !== 0)
      throw new Error(
        timedOut
          ? 'O conversor PST/OST ficou 30 minutos sem produzir uma mensagem. Verifique o arquivo e retome a importação.'
          : error?.message === 'spawn python3 ENOENT'
            ? 'Conversor PST/OST indisponível. Instale Python/pypff no worker.'
            : 'Não foi possível ler PST/OST. O arquivo pode estar corrompido, criptografado ou usar uma versão não suportada.',
      );
  } finally {
    clearTimeout(timeout);
    child.stdout.destroy();
    child.kill();
  }
}
export async function* readMailArchive(
  filename: string,
  format: string,
  displayName = basename(filename),
): AsyncGenerator<ArchiveMessage> {
  if (format === 'zip') {
    yield* zipMessages(filename);
    return;
  }
  if (format === 'pst' || format === 'ost') {
    yield* pffMessages(filename);
    return;
  }
  const stream = createReadStream(filename);
  try {
    yield* textMessages(
      stream,
      format,
      basename(displayName).replace(/\.[^.]+$/, '') || 'Importados',
    );
  } finally {
    stream.destroy();
  }
}
