import { useEffect, useRef, useState } from 'react';
import { Maximize2, X } from 'lucide-react';

export function ImageLightbox({ src, alt }: { src: string; alt: string }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', close); document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', close); document.body.style.overflow = ''; };
  }, [open]);
  useEffect(() => { if (!open) trigger.current?.focus(); }, [open]);
  return <>
    <button ref={trigger} className="article-image" onClick={() => setOpen(true)} aria-label={`Ampliar imagem: ${alt}`}><img src={src} alt={alt} /><span><Maximize2 size={15} /> Ampliar</span></button>
    {open && <div className="lightbox" role="dialog" aria-modal="true" aria-label={alt} onClick={() => setOpen(false)}><button className="lightbox-close" onClick={() => setOpen(false)} aria-label="Fechar imagem"><X /></button><img src={src} alt={alt} onClick={(event) => event.stopPropagation()} /></div>}
  </>;
}
