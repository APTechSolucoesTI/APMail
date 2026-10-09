import {
  MAIL_ARCHIVE_CHUNK_BYTES,
  MAIL_ARCHIVE_FINGERPRINT_BYTES,
  type MailArchiveTask,
} from '@apmail/shared';
import { api, ApiError } from './api';
import { sha256 } from '@noble/hashes/sha2.js';

/** Bounded fingerprint, identical to the server's first/last-byte check. */
export async function archiveFingerprint(file: File) {
  const first = await file.slice(0, MAIL_ARCHIVE_FINGERPRINT_BYTES).arrayBuffer();
  const last = await file
    .slice(Math.max(0, file.size - MAIL_ARCHIVE_FINGERPRINT_BYTES))
    .arrayBuffer();
  const sample = new Uint8Array(first.byteLength + last.byteLength);
  sample.set(new Uint8Array(first));
  sample.set(new Uint8Array(last), first.byteLength);
  // Works on the LAN over HTTP as well as HTTPS, without requiring WebCrypto.
  return Array.from(sha256(sample), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sendBlock(
  path: string,
  block: Blob,
  offset: number,
  signal: AbortSignal,
  progress: (bytes: number) => void,
) {
  return new Promise<MailArchiveTask>((resolve, reject) => {
    signal.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener('abort', abort);
    xhr.open('PATCH', '/api' + path);
    xhr.withCredentials = true;
    xhr.timeout = 120000;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('Upload-Offset', String(offset));
    xhr.upload.onprogress = (event) => progress(event.loaded);
    xhr.onload = () => {
      cleanup();
      let data: { error?: { code?: string; message?: string } } & MailArchiveTask;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        reject(
          new ApiError(
            xhr.status,
            'archive_proxy',
            xhr.status === 413
              ? 'O servidor recusou o bloco do arquivo. Verifique o limite de upload do proxy.'
              : 'O servidor não respondeu ao envio. Tente continuar do último bloco confirmado.',
          ),
        );
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else
        reject(
          new ApiError(
            xhr.status,
            data.error?.code ?? 'archive_upload',
            data.error?.message ?? 'Não foi possível receber o bloco do arquivo.',
          ),
        );
    };
    xhr.onerror = xhr.ontimeout = () => {
      cleanup();
      reject(
        new ApiError(
          0,
          'network_error',
          'A conexão foi interrompida. O progresso confirmado foi preservado; tente continuar o envio.',
        ),
      );
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException('Envio interrompido.', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    xhr.send(block);
  });
}

/** Each acknowledged offset is durable. A lost response is resolved by consulting the
 * checkpoint rather than replaying the block and duplicating archive bytes. */
export async function uploadArchiveBlocks(
  mailboxId: string,
  initial: MailArchiveTask,
  file: File,
  signal: AbortSignal,
  progress: (percent: number) => void,
) {
  const path = `/mailboxes/${mailboxId}/archive-imports/${initial.id}/upload`;
  let task = await api<MailArchiveTask>(path, { signal });
  let retries = 0;
  while (task.state === 'uploading') {
    signal.throwIfAborted();
    const offset = Number(task.uploaded_bytes);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      offset >= file.size ||
      Number(task.size_bytes) !== file.size
    )
      throw new Error(
        'O checkpoint não corresponde ao arquivo selecionado. Cancele a importação e selecione o backup original.',
      );
    progress(Math.floor((offset * 100) / file.size));
    try {
      const next = await sendBlock(
        path,
        file.slice(offset, offset + MAIL_ARCHIVE_CHUNK_BYTES),
        offset,
        signal,
        (bytes) => progress(Math.min(99, Math.floor(((offset + bytes) * 100) / file.size))),
      );
      if (Number(next.uploaded_bytes) <= offset)
        throw new Error('O servidor não confirmou o progresso do envio.');
      task = next;
      retries = 0;
    } catch (error) {
      if (signal.aborted) throw error;
      const retryable =
        error instanceof ApiError &&
        ([0, 408, 429, 500, 502, 503, 504].includes(error.status) ||
          error.code === 'archive_upload_offset');
      if (!retryable || ++retries > 3) throw error;
      // Small abortable backoff also handles rate limits during fast LAN uploads.
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException('Envio interrompido.', 'AbortError'));
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener('abort', abort);
            resolve();
          },
          error.status === 429 ? 15000 : retries * 1000,
        );
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
      task = await api<MailArchiveTask>(path, { signal });
    }
  }
  if (['cancelled', 'failed'].includes(task.state))
    throw new Error('Esta importação foi encerrada. Selecione o arquivo para iniciar outra.');
  if (Number(task.uploaded_bytes) !== file.size)
    throw new Error('O servidor não confirmou o recebimento completo do arquivo.');
  progress(100);
  return task;
}
