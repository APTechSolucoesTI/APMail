import { beforeEach, expect, it, vi } from 'vitest';
import { api } from './api';
import { cutMail, pasteCutMail } from './mail-cut';
import { MAIL_MOVED_EVENT } from './mail-drag';

vi.mock('./api', () => ({ api: vi.fn() }));
const cut = {
  tenantId: 'company',
  userId: 'person',
  mailboxId: 'source',
  threadId: 'conversation',
  messageId: 'message',
  messages: [{ id: 'message', folderId: 'inbox' }],
};
beforeEach(() => {
  vi.mocked(api).mockReset();
  cutMail(cut);
});
it('moves exact message IDs once across mailboxes only when pasted', async () => {
  expect(api).not.toHaveBeenCalled();
  let complete!: () => void;
  vi.mocked(api).mockReturnValue(
    new Promise<void>((resolve) => {
      complete = resolve;
    }),
  );
  const moved = vi.fn();
  window.addEventListener(MAIL_MOVED_EVENT, moved);
  const first = pasteCutMail('company', 'person', 'destination', 'folder');
  expect(await pasteCutMail('company', 'person', 'destination', 'folder')).toBe(false);
  expect(api).toHaveBeenCalledExactlyOnceWith('/mailboxes/source/messages/actions', {
    method: 'POST',
    body: {
      type: 'move',
      message_ids: ['message'],
      target_folder_id: 'folder',
      target_mailbox_id: 'destination',
    },
  });
  complete();
  expect(await first).toBe(true);
  expect(await pasteCutMail('company', 'person', 'destination', 'folder')).toBe(false);
  expect(moved).toHaveBeenCalledOnce();
  window.removeEventListener(MAIL_MOVED_EVENT, moved);
});
it('keeps the cut available after failure and denies another user, company or same folder', async () => {
  expect(await pasteCutMail('other', 'person', 'target', 'folder')).toBe(false);
  expect(await pasteCutMail('company', 'other', 'target', 'folder')).toBe(false);
  expect(await pasteCutMail('company', 'person', 'source', 'inbox')).toBe(false);
  expect(api).not.toHaveBeenCalled();
  const failure = new Error('Sem permissão');
  vi.mocked(api).mockRejectedValueOnce(failure).mockResolvedValue({});
  await expect(pasteCutMail('company', 'person', 'target', 'folder')).rejects.toBe(failure);
  expect(await pasteCutMail('company', 'person', 'target', 'folder')).toBe(true);
});
it('preserves a new cut created while an earlier paste completes', async () => {
  let complete!: () => void;
  vi.mocked(api)
    .mockReturnValueOnce(
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    )
    .mockResolvedValue({});
  const first = pasteCutMail('company', 'person', 'target', 'folder');
  cutMail({ ...cut, messages: [{ id: 'new-message', folderId: 'inbox' }] });
  complete();
  expect(await first).toBe(true);
  expect(await pasteCutMail('company', 'person', 'target', 'folder')).toBe(true);
  expect(vi.mocked(api).mock.calls.at(-1)?.[1]?.body).toMatchObject({
    message_ids: ['new-message'],
  });
});
