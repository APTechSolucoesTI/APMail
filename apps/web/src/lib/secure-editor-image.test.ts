import { afterEach, expect, it, vi } from 'vitest';
import { api } from './api';
import { secureEditorImage } from './secure-editor-image';
import { pendingSecurity } from './antivirus';
vi.mock('./api', () => ({ api: vi.fn() }));
afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
});
it('waits for a clean result before requesting signature bytes and cancels polling on destroy', async () => {
  vi.useFakeTimers();
  vi.mocked(api)
    .mockResolvedValueOnce(pendingSecurity)
    .mockResolvedValueOnce({ ...pendingSecurity, status: 'clean' });
  const view = secureEditorImage({
    signatureImageId: 'signature-id',
    src: 'https://example.com/unsafe',
  });
  const image = view.dom.querySelector('img')!;
  expect(image.getAttribute('src')).toBeNull();
  await vi.advanceTimersByTimeAsync(15000);
  expect(image.getAttribute('src')).toBe('/api/signatures/images/signature-id');
  expect(image.hidden).toBe(false);
  view.destroy();
  await vi.advanceTimersByTimeAsync(30000);
  expect(api).toHaveBeenCalledTimes(2);
});
it('never loads an infected image, including an internal src without metadata attributes', async () => {
  vi.mocked(api).mockResolvedValue({
    ...pendingSecurity,
    status: 'infected',
    threat_name: 'Eicar-Test-Signature',
  });
  const view = secureEditorImage({ src: '/api/uploads/abcdef/image' });
  await Promise.resolve();
  expect(api).toHaveBeenCalledWith('/uploads/abcdef/security', expect.any(Object));
  expect(view.dom.querySelector('img')!.getAttribute('src')).toBeNull();
  expect(view.dom.textContent).toContain('Ameaça detectada');
  view.destroy();
});
it('keeps a failed scan blocked and retries while the editor is open', async () => {
  vi.useFakeTimers();
  vi.mocked(api).mockRejectedValue(new Error('offline'));
  const view = secureEditorImage({ uploadId: 'upload-id' });
  await vi.advanceTimersByTimeAsync(15000);
  expect(view.dom.textContent).toContain('indisponível');
  expect(view.dom.querySelector('img')!.getAttribute('src')).toBeNull();
  view.destroy();
  await vi.advanceTimersByTimeAsync(30000);
  expect(api).toHaveBeenCalledTimes(2);
});
