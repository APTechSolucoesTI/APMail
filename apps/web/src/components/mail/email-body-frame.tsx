import { useMemo, useRef, useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { Button } from '@/components/ui/button';
export function EmailBodyFrame({
  html,
  cidMap,
  loadRemoteImages = false,
}: {
  html: string;
  cidMap: Record<string, string>;
  loadRemoteImages?: boolean;
}) {
  const [showImages, setShowImages] = useState(false),
    frame = useRef<HTMLIFrameElement>(null);
  const { srcDoc, hasRemote } = useMemo(() => {
    const clean = DOMPurify.sanitize(html, {
      ADD_ATTR: ['data-apmail-src', 'data-apmail-cid', 'target'],
      FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'script'],
    });
    const doc = new DOMParser().parseFromString(clean, 'text/html');
    let hasRemote = false;
    for (const img of doc.querySelectorAll('img')) {
      let remote = img.getAttribute('data-apmail-src');
      const src = img.getAttribute('src') ?? '';
      if (/^https?:\/\//i.test(src)) remote = src;
      img.removeAttribute('src');
      if (remote && /^https?:\/\//i.test(remote)) {
        hasRemote = true;
        if (showImages || loadRemoteImages) img.src = remote;
      } else if (img.dataset.apmailCid && cidMap[img.dataset.apmailCid])
        img.src = '/api/attachments/' + cidMap[img.dataset.apmailCid] + '/inline';
      else if (/^data:image\/(png|gif|jpeg|webp);base64,/i.test(src) && src.length <= 200 * 1024)
        img.src = src;
    }
    for (const a of doc.querySelectorAll('a')) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer nofollow';
    }
    const csp =
      "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:" +
      (showImages || loadRemoteImages ? ' https: http:' : '') +
      "; base-uri 'none'; form-action 'none'";
    return {
      hasRemote,
      srcDoc: `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>body{font:14px/1.5 Inter,system-ui,sans-serif;color:#111827;background:white;margin:0;padding:16px;overflow-wrap:anywhere}img{max-width:100%;height:auto}table{max-width:100%}blockquote{border-left:3px solid #E4E7EC;margin-left:0;padding-left:16px;color:#667085}a{color:#137A98}pre{white-space:pre-wrap}</style></head><body>${doc.body.innerHTML}</body></html>`,
    };
  }, [html, cidMap, showImages, loadRemoteImages]);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    let observer: ResizeObserver | undefined;
    const update = () => {
      const body = element.contentDocument?.body;
      if (!body) return;
      element.style.height = Math.max(80, body.scrollHeight + 4) + 'px';
    };
    const loaded = () => {
      observer?.disconnect();
      update();
      const body = element.contentDocument?.body;
      if (body) {
        observer = new ResizeObserver(update);
        observer.observe(body);
      }
    };
    element.addEventListener('load', loaded);
    loaded();
    return () => {
      element.removeEventListener('load', loaded);
      observer?.disconnect();
    };
  }, [srcDoc]);
  return (
    <div className="overflow-hidden rounded-md border">
      {hasRemote && !showImages && !loadRemoteImages && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted p-3">
          <p className="text-xs">
            As imagens externas foram bloqueadas para proteger sua privacidade.
          </p>
          <Button size="sm" variant="outline" onClick={() => setShowImages(true)}>
            Exibir imagens
          </Button>
        </div>
      )}
      <iframe
        ref={frame}
        title="Conteúdo do e-mail"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={srcDoc}
        className="block min-h-20 w-full border-0 bg-white"
      />
    </div>
  );
}
