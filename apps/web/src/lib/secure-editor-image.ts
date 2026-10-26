import { api } from './api';
import { antivirusStatusLabel, pendingSecurity, type AttachmentSecurity } from './antivirus';

/** Editor-only view: pending placeholders never become part of the outgoing HTML. */
export function secureEditorImage(attributes: Record<string, unknown>) {
  const dom = document.createElement('div');
  const image = document.createElement('img');
  const status = document.createElement('span');
  status.className = 'inline-block rounded border bg-muted px-3 py-2 text-xs text-muted-foreground';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  image.alt = typeof attributes.alt === 'string' ? attributes.alt : '';
  if (attributes.width) image.width = Number(attributes.width);
  if (attributes.height) image.height = Number(attributes.height);
  dom.append(status, image);
  const signature =
    typeof attributes.signatureImageId === 'string' ? attributes.signatureImageId : null;
  const upload = typeof attributes.uploadId === 'string' ? attributes.uploadId : null;
  const source = typeof attributes.src === 'string' ? attributes.src : '';
  const internal = signature
    ? `/signatures/images/${encodeURIComponent(signature)}`
    : upload
      ? `/uploads/${encodeURIComponent(upload)}`
      : source.match(
          /^\/api(\/(?:signatures\/images|uploads)\/[\da-f-]+)(?:\/image)?(?:\?.*)?$/i,
        )?.[1];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  const controller = new AbortController();
  image.hidden = !!internal;
  status.hidden = !internal;
  if (!internal) image.src = source;
  else {
    const show = (security: AttachmentSecurity) => {
      status.textContent = antivirusStatusLabel(security);
      image.hidden = security.status !== 'clean';
      status.hidden = security.status === 'clean';
      if (security.status === 'clean')
        image.src = '/api' + internal + (internal.startsWith('/uploads/') ? '/image' : '');
    };
    show(pendingSecurity);
    const check = async () => {
      let security: AttachmentSecurity;
      try {
        security = await api<AttachmentSecurity>(internal + '/security', {
          signal: controller.signal,
        });
        if (!security || !['pending', 'clean', 'infected', 'error'].includes(security.status))
          throw new Error('Invalid security response');
      } catch {
        security = { ...pendingSecurity, status: 'error' };
      }
      if (disposed) return;
      show(security);
      if (security.status === 'pending' || security.status === 'error')
        timer = setTimeout(() => void check(), 15000);
    };
    image.onerror = () => {
      image.hidden = true;
      status.hidden = false;
      status.textContent = 'Imagem indisponível. Aguarde uma verificação válida.';
    };
    void check();
  }
  return {
    dom,
    destroy() {
      disposed = true;
      controller.abort();
      clearTimeout(timer);
    },
  };
}
