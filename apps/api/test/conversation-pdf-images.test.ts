import { expect, it } from 'vitest';
import { fetchPdfImage, pdfImageSources } from '../src/modules/conversation-pdf-images.js';
it('resolves the persisted image references without interpreting surrounding scripts', () => {
  expect(
    pdfImageSources(
      '<img data-apmail-cid="logo@company"><img data-apmail-src="https://example.com/logo.jpg"><img src="cid:second"><script>secret</script>',
    ),
  ).toEqual(['cid:logo@company', 'https://example.com/logo.jpg', 'cid:second']);
});
it('rejects private destinations and URL credentials before opening an image connection', async () => {
  for (const url of [
    'http://127.0.0.1/x',
    'http://169.254.169.254/x',
    'http://[::1]/x',
    'https://user:password@example.com/x',
    'file:///tmp/image',
  ])
    await expect(fetchPdfImage(url)).rejects.toThrow();
});
