import { useSyncExternalStore } from 'react';
import type { MailArchiveTask } from '@apmail/shared';
import { toast } from 'sonner';
import { api } from './api';
import { uploadArchiveBlocks } from './mail-archive-upload';
import { queryClient } from './query-client';

export type ArchiveTransferScope = { tenantId: string; userId: string; mailboxId: string };
export type ArchiveTransfer = {
  scope: ArchiveTransferScope;
  runId: number;
  file: File | null;
  filename: string;
  fingerprint: string;
  task: MailArchiveTask | null;
  progress: number;
  status: 'sending' | 'received' | 'failed' | 'interrupted';
  error: string;
};
const key = (scope: ArchiveTransferScope) =>
  JSON.stringify([scope.tenantId, scope.userId, scope.mailboxId]);
const transfers = new Map<string, ArchiveTransfer>();
const controllers = new Map<string, AbortController>();
const runs = new Map<string, Promise<MailArchiveTask>>();
const listeners = new Set<() => void>();
let snapshot: readonly ArchiveTransfer[] = [];
let nextRun = 0;
const publish = () => {
  snapshot = [...transfers.values()];
  for (const listener of listeners) listener();
};
export function subscribeArchiveTransfers(listener: () => void) {
  listeners.add(listener);
  // Closing a panel unsubscribes its UI; it does not cancel the file transfer.
  return () => {
    listeners.delete(listener);
  };
}
export const getArchiveTransfers = () => snapshot;
export function useArchiveTransfers() {
  return useSyncExternalStore(subscribeArchiveTransfers, getArchiveTransfers, getArchiveTransfers);
}
export function clearArchiveTransfer(scope: ArchiveTransferScope) {
  if (transfers.get(key(scope))?.status === 'sending') return;
  transfers.delete(key(scope));
  publish();
}
export function interruptArchiveTransfer(scope: ArchiveTransferScope) {
  controllers.get(key(scope))?.abort();
}
export function stopArchiveTransfersForUser(userId: string) {
  for (const [id, transfer] of transfers) {
    if (transfer.scope.userId !== userId) continue;
    controllers.get(id)?.abort();
    transfers.delete(id);
  }
  publish();
}
const refresh = (scope: ArchiveTransferScope) => {
  void queryClient.invalidateQueries({
    queryKey: ['mail-archives', scope.tenantId, scope.userId, scope.mailboxId],
  });
  void queryClient.invalidateQueries({ queryKey: ['storage-quota'] });
};

/** The File and transfer lifetime belong to the authenticated app, not a modal. */
export function startArchiveTransfer(
  scope: ArchiveTransferScope,
  file: File,
  fingerprint: string,
  initial: MailArchiveTask | null,
) {
  const id = key(scope);
  const active = runs.get(id);
  if (active && transfers.get(id)?.status === 'sending') return active;
  const controller = new AbortController();
  controllers.set(id, controller);
  const runId = ++nextRun;
  transfers.set(id, {
    scope,
    runId,
    file,
    filename: file.name,
    fingerprint,
    task: initial,
    progress: Math.floor((Number(initial?.uploaded_bytes ?? 0) * 100) / file.size),
    status: 'sending',
    error: '',
  });
  publish();
  const update = (change: Partial<ArchiveTransfer>) => {
    const current = transfers.get(id);
    if (current?.runId !== runId) return;
    transfers.set(id, { ...current, ...change });
    publish();
  };
  const run = (async () => {
    try {
      const base = '/mailboxes/' + scope.mailboxId + '/archive-imports';
      let task = initial
        ? await api<MailArchiveTask>(base + '/' + initial.id + '/upload', {
            signal: controller.signal,
          })
        : null;
      if (!task) {
        const existing = await api<MailArchiveTask[]>(base, { signal: controller.signal });
        task =
          existing.find(
            (t) =>
              t.state === 'uploading' &&
              t.filename === file.name &&
              Number(t.size_bytes) === file.size &&
              t.upload_fingerprint === fingerprint,
          ) ?? null;
      }
      if (!task || task.state === 'uploading') {
        await api(base + '/preflight', {
          method: 'POST',
          signal: controller.signal,
          body: { filename: file.name, size_bytes: file.size - Number(task?.uploaded_bytes ?? 0) },
        });
      }
      if (!task) {
        task = await api<MailArchiveTask>(base, {
          method: 'POST',
          signal: controller.signal,
          body: { filename: file.name, size_bytes: file.size, upload_fingerprint: fingerprint },
        });
      }
      update({ task });
      refresh(scope);
      const received = await uploadArchiveBlocks(
        scope.mailboxId,
        task,
        file,
        controller.signal,
        (progress) => update({ progress }),
      );
      update({ status: 'received', progress: 100, file: null, task: received });
      toast.success(
        'Arquivo recebido. A importação continua no servidor; você pode fechar o painel.',
      );
      return received;
    } catch (error) {
      const message = controller.signal.aborted
        ? 'Envio interrompido. Os blocos confirmados foram preservados; continue o envio com o mesmo arquivo.'
        : error instanceof Error
          ? error.message
          : 'Não foi possível enviar o arquivo. O progresso confirmado foi preservado.';
      update({ status: controller.signal.aborted ? 'interrupted' : 'failed', error: message });
      if (transfers.get(id)?.runId === runId) toast.error(message);
      throw error;
    } finally {
      if (controllers.get(id) === controller) {
        controllers.delete(id);
        runs.delete(id);
      }
      refresh(scope);
    }
  })();
  runs.set(id, run);
  return run;
}
