import { afterEach, expect, it, vi } from 'vitest';
import { File as NodeFile } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  MAIL_ARCHIVE_CHUNK_BYTES,
  MAIL_ARCHIVE_FINGERPRINT_BYTES,
  type MailArchiveTask,
} from '@apmail/shared';
import { archiveFingerprint, uploadArchiveBlocks } from './mail-archive-upload';
import { api } from './api';

vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  api: vi.fn(),
}));
const task = (
  bytes: number,
  uploaded = 0,
  state: MailArchiveTask['state'] = 'uploading',
): MailArchiveTask => ({
  id: 'task',
  filename: 'backup.pst',
  format: 'pst',
  size_bytes: String(bytes),
  uploaded_bytes: String(uploaded),
  upload_fingerprint: null,
  analyzed_messages: 0,
  expanded_bytes: '0',
  processed_bytes: '0',
  added_storage_bytes: '0',
  analyzed_at: null,
  state,
  cursor: 0,
  imported: 0,
  skipped: 0,
  last_error: null,
  created_at: '',
  updated_at: '',
});
const file = (bytes: Buffer) =>
  new NodeFile([Uint8Array.from(bytes)], 'backup.pst') as unknown as File;
type Block = { offset: number; size: number; method: string; path: string };
function transport(onSend: (block: Block, xhr: FakeXHR) => void) {
  const sent: Block[] = [];
  class XHR {
    status = 200;
    responseText = '';
    withCredentials = false;
    timeout = 0;
    upload: { onprogress?: (e: { loaded: number }) => void } = {};
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    method = '';
    path = '';
    headers: Record<string, string> = {};
    open(method: string, path: string) {
      this.method = method;
      this.path = path;
    }
    setRequestHeader(key: string, value: string) {
      this.headers[key] = value;
    }
    send(blob: Blob) {
      const block = {
        offset: Number(this.headers['Upload-Offset']),
        size: blob.size,
        method: this.method,
        path: this.path,
      };
      sent.push(block);
      queueMicrotask(() => onSend(block, this));
    }
    abort() {
      this.onabort?.();
    }
  }
  vi.stubGlobal('XMLHttpRequest', XHR);
  return sent;
}
type FakeXHR = {
  status: number;
  responseText: string;
  upload: { onprogress?: (e: { loaded: number }) => void };
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.useRealTimers();
});

it('fingerprints first/last bytes consistently with the server, including small files without WebCrypto', async () => {
  vi.stubGlobal('crypto', {});
  for (const bytes of [Buffer.from('!BDN small file'), Buffer.alloc(200000, 42)]) {
    const expected = createHash('sha256')
      .update(bytes.subarray(0, MAIL_ARCHIVE_FINGERPRINT_BYTES))
      .update(bytes.subarray(Math.max(0, bytes.length - MAIL_ARCHIVE_FINGERPRINT_BYTES)))
      .digest('hex');
    expect(await archiveFingerprint(file(bytes))).toBe(expected);
  }
});
it('sends bounded blocks, starts at the saved offset and reports complete only after acknowledgement', async () => {
  const size = MAIL_ARCHIVE_CHUNK_BYTES * 3 + 100;
  vi.mocked(api).mockResolvedValue(task(size, MAIL_ARCHIVE_CHUNK_BYTES));
  const progress: number[] = [];
  const sent = transport((block, xhr) => {
    xhr.upload.onprogress?.({ loaded: block.size });
    expect(progress.at(-1)).toBeLessThan(100);
    const end = block.offset + block.size;
    xhr.responseText = JSON.stringify(task(size, end, end === size ? 'queued' : 'uploading'));
    xhr.onload?.();
  });
  await uploadArchiveBlocks(
    'box',
    task(size),
    file(Buffer.alloc(size)),
    new AbortController().signal,
    (p) => progress.push(p),
  );
  expect(sent.map((b) => [b.offset, b.size])).toEqual([
    [MAIL_ARCHIVE_CHUNK_BYTES, MAIL_ARCHIVE_CHUNK_BYTES],
    [MAIL_ARCHIVE_CHUNK_BYTES * 2, MAIL_ARCHIVE_CHUNK_BYTES],
    [MAIL_ARCHIVE_CHUNK_BYTES * 3, 100],
  ]);
  expect(sent.every((b) => b.method === 'PATCH' && b.path.endsWith('/task/upload'))).toBe(true);
  expect(progress.at(-1)).toBe(100);
});
it('consults the server after a lost response and does not resend an acknowledged block', async () => {
  vi.useFakeTimers();
  const size = MAIL_ARCHIVE_CHUNK_BYTES + 100;
  vi.mocked(api)
    .mockResolvedValueOnce(task(size))
    .mockResolvedValueOnce(task(size, MAIL_ARCHIVE_CHUNK_BYTES));
  const sent = transport((block, xhr) => {
    if (block.offset === 0) xhr.onerror?.();
    else {
      xhr.responseText = JSON.stringify(task(size, size, 'queued'));
      xhr.onload?.();
    }
  });
  const uploading = uploadArchiveBlocks(
    'box',
    task(size),
    file(Buffer.alloc(size)),
    new AbortController().signal,
    () => {},
  );
  await vi.runAllTimersAsync();
  await expect(uploading).resolves.toMatchObject({ state: 'queued' });
  expect(sent.map((b) => b.offset)).toEqual([0, MAIL_ARCHIVE_CHUNK_BYTES]);
  expect(api).toHaveBeenCalledTimes(2);
});
it('stops immediately on abort or blocking quota errors without sending another block', async () => {
  const size = MAIL_ARCHIVE_CHUNK_BYTES + 100;
  vi.mocked(api).mockResolvedValue(task(size));
  const controller = new AbortController();
  const aborted = transport(() => controller.abort());
  await expect(
    uploadArchiveBlocks('box', task(size), file(Buffer.alloc(size)), controller.signal, () => {}),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(aborted).toHaveLength(1);
  const blocked = transport((_block, xhr) => {
    xhr.status = 409;
    xhr.responseText = JSON.stringify({
      error: { code: 'archive_quota_exceeded', message: 'A cota está cheia.' },
    });
    xhr.onload?.();
  });
  await expect(
    uploadArchiveBlocks(
      'box',
      task(size),
      file(Buffer.alloc(size)),
      new AbortController().signal,
      () => {},
    ),
  ).rejects.toMatchObject({ code: 'archive_quota_exceeded' });
  expect(blocked).toHaveLength(1);
});
