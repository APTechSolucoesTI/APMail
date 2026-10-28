import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker';

// Vite emits this worker as .js, with a fresh URL and JavaScript MIME type behind nginx/CDNs.
GlobalWorkerOptions.workerPort = new PdfWorker();

/** Render the actual PDF without depending on a browser's optional PDF plug-in. */
export async function renderPdfPreview(
  data: ArrayBuffer,
  container: HTMLElement,
  signal: AbortSignal,
  password?: string,
) {
  const task = getDocument({ data, useSystemFonts: true, password });
  const abort = () => {
    void task.destroy();
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    const pdf = await task.promise;
    container.replaceChildren();
    for (let number = 1; number <= pdf.numPages; number++) {
      if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      const page = await pdf.getPage(number),
        viewport = page.getViewport({ scale: 1.75 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      canvas.className = 'mx-auto mb-4 block h-auto w-full max-w-[840px] bg-white shadow-sm';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `Página ${number} de ${pdf.numPages}`);
      await page.render({ canvas, viewport }).promise;
      if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
      // Text remains available to assistive technology even though the preview uses a canvas.
      const text = await page.getTextContent();
      const accessible = document.createElement('p');
      accessible.className = 'sr-only';
      accessible.textContent = text.items.map((item) => ('str' in item ? item.str : '')).join(' ');
      container.append(canvas, accessible);
      page.cleanup();
    }
    return pdf.numPages;
  } finally {
    signal.removeEventListener('abort', abort);
    await task.destroy();
  }
}

/** A same-origin HTML print document opens the native print dialog in browsers and WebViews. */
export async function printPdfPages(container: HTMLElement, title: string) {
  const canvases = [...container.querySelectorAll('canvas')];
  if (!canvases.length) throw new Error('Aguarde a preparação das páginas para imprimir.');
  const frame = document.createElement('iframe');
  frame.title = 'Impressão da conversa';
  frame.className = 'fixed -left-[10000px] top-0 h-px w-px border-0';
  document.body.append(frame);
  const printWindow = frame.contentWindow,
    doc = frame.contentDocument;
  if (!printWindow || !doc) {
    frame.remove();
    throw new Error('Não foi possível preparar a impressão.');
  }
  const cleanup = () => frame.remove();
  try {
    doc.title = title;
    const style = doc.createElement('style');
    style.textContent =
      '@page{size:A4;margin:0}html,body{margin:0;padding:0;background:white}.pdf-page{width:210mm;height:296mm;overflow:hidden;break-inside:avoid;break-after:page;page-break-after:always}.pdf-page:last-child{break-after:auto;page-break-after:auto}img{display:block;width:100%;height:100%;object-fit:contain}';
    doc.head.append(style);
    await Promise.all(
      canvases.map(
        (canvas) =>
          new Promise<void>((resolve, reject) => {
            const img = doc.createElement('img');
            img.alt = canvas.getAttribute('aria-label') ?? '';
            img.onload = () => resolve();
            img.onerror = () =>
              reject(new Error('Não foi possível preparar as páginas para impressão.'));
            img.src = canvas.toDataURL('image/png');
            const page = doc.createElement('div');
            page.className = 'pdf-page';
            page.append(img);
            doc.body.append(page);
          }),
      ),
    );
    printWindow.addEventListener('afterprint', cleanup, { once: true });
    printWindow.focus();
    printWindow.print();
    // Some WebViews omit afterprint. Keep the document alive while the system dialog uses it.
    setTimeout(cleanup, 120000);
  } catch (error) {
    cleanup();
    throw error;
  }
}
