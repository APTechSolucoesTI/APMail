import { afterEach, expect, it, vi } from 'vitest';
import type { MailArchiveTask } from '@apmail/shared';
import { api } from './api';
import { uploadArchiveBlocks } from './mail-archive-upload';
import {
  getArchiveTransfers,
  startArchiveTransfer,
  stopArchiveTransfersForUser,
  subscribeArchiveTransfers,
} from './mail-archive-transfers';

vi.mock('./api', () => ({ api: vi.fn() }));
vi.mock('./mail-archive-upload', () => ({ uploadArchiveBlocks: vi.fn() }));
vi.mock('./query-client', () => ({
  queryClient: { invalidateQueries: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
const scope = { tenantId: 'tenant', userId: 'user', mailboxId: 'box' };
const file = new File(['content'], 'backup.pst');
const task = {
  id: 'task',
  filename: file.name,
  size_bytes: String(file.size),
  uploaded_bytes: '0',
  state: 'uploading',
  upload_fingerprint: 'hash',
} as MailArchiveTask;
afterEach(() => {
  stopArchiveTransfersForUser(scope.userId);
  vi.clearAllMocks();
});
it('keeps sending after the panel unsubscribes and prevents double submission', async () => {
  vi.mocked(api).mockResolvedValue(task);
  let finish!: (value: MailArchiveTask) => void;
  let signal!: AbortSignal;
  vi.mocked(uploadArchiveBlocks).mockImplementation((_box, _task, _file, abort) => {
    signal = abort;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  const unsubscribe = subscribeArchiveTransfers(vi.fn());
  const running = startArchiveTransfer(scope, file, 'hash', task);
  expect(startArchiveTransfer(scope, file, 'hash', task)).toBe(running);
  await vi.waitFor(() => expect(uploadArchiveBlocks).toHaveBeenCalledTimes(1));
  unsubscribe();
  expect(signal.aborted).toBe(false);
  expect(getArchiveTransfers()[0]?.status).toBe('sending');
  finish({ ...task, state: 'queued', uploaded_bytes: String(file.size) });
  await running;
  expect(getArchiveTransfers()[0]).toMatchObject({ status: 'received', file: null, progress: 100 });
});
it('retains the selected file and task on failure and consults the server checkpoint on retry', async () => {
  vi.mocked(api).mockResolvedValue(task);
  vi.mocked(uploadArchiveBlocks).mockRejectedValueOnce(new Error('Rede indisponível'));
  await expect(startArchiveTransfer(scope, file, 'hash', task)).rejects.toMatchObject({
    message: 'Rede indisponível',
  });
  expect(getArchiveTransfers()[0]).toMatchObject({ status: 'failed', file, task });
  const checkpoint = { ...task, uploaded_bytes: '3' };
  vi.mocked(api).mockResolvedValueOnce(checkpoint).mockResolvedValueOnce({});
  vi.mocked(uploadArchiveBlocks).mockResolvedValueOnce({
    ...checkpoint,
    state: 'queued',
    uploaded_bytes: String(file.size),
  });
  await startArchiveTransfer(scope, file, 'hash', getArchiveTransfers()[0]!.task);
  expect(vi.mocked(uploadArchiveBlocks).mock.calls[1]?.[1]).toEqual(checkpoint);
  expect(
    vi
      .mocked(api)
      .mock.calls.some(
        ([path, options]) => path.endsWith('/archive-imports') && options?.method === 'POST',
      ),
  ).toBe(false);
});
it('aborts on logout without restoring another user’s transfer through late callbacks', async () => {
  vi.mocked(api).mockResolvedValue(task);
  let reject!: (error: Error) => void;
  let signal!: AbortSignal;
  vi.mocked(uploadArchiveBlocks).mockImplementation((_box, _task, _file, abort) => {
    signal = abort;
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  });
  const running = startArchiveTransfer(scope, file, 'hash', task);
  await vi.waitFor(() => expect(uploadArchiveBlocks).toHaveBeenCalled());
  stopArchiveTransfersForUser('another-user');
  expect(signal.aborted).toBe(false);
  stopArchiveTransfersForUser(scope.userId);
  expect(signal.aborted).toBe(true);
  reject(new Error('aborted'));
  await expect(running).rejects.toMatchObject({ message: 'aborted' });
  expect(getArchiveTransfers()).toEqual([]);
});
