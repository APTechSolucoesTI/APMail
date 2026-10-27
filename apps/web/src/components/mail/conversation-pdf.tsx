import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, LoaderCircle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export function ConversationPdf({ threadId, subject }: { threadId: string; subject?: string }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; url: string | null; error: boolean } | null>(
    null,
  );
  const requestKey = `${threadId}:${attempt}`;
  const current = result?.key === requestKey ? result : null;
  const url = current?.url ?? null;
  const error = current?.error ?? false;
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/pdf`, {
          credentials: 'same-origin',
          signal: controller.signal,
        });
        if (!response.ok || !response.headers.get('Content-Type')?.includes('application/pdf'))
          throw new Error('pdf_unavailable');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob);
        setResult({ key: requestKey, url: objectUrl, error: false });
      } catch {
        if (!controller.signal.aborted) setResult({ key: requestKey, url: null, error: true });
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, threadId, requestKey]);

  const print = () => {
    try {
      if (!frame.current?.contentWindow) throw new Error('preview_unavailable');
      frame.current.contentWindow.focus();
      frame.current.contentWindow.print();
    } catch {
      toast.error('Abra o PDF em uma nova aba para usar a impressão do navegador.');
    }
  };
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label="Imprimir conversa"
        title="Imprimir conversa"
        onClick={() => {
          setAttempt((value) => value + 1);
          setOpen(true);
        }}
      >
        <Printer />
        <span className="hidden sm:inline">Imprimir</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[90dvh] max-h-[960px] flex-col sm:max-w-5xl">
          <DialogHeader className="pr-7">
            <DialogTitle>Imprimir conversa</DialogTitle>
            <DialogDescription>
              Todas as mensagens às quais você tem acesso, em ordem cronológica, com os nomes e
              identificadores dos anexos.
            </DialogDescription>
          </DialogHeader>
          {!url && !error && (
            <div
              role="status"
              className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
            >
              <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />
              Preparando PDF da conversa…
            </div>
          )}
          {error && (
            <div
              role="alert"
              className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-sm"
            >
              <p>Não foi possível preparar o PDF. Tente novamente.</p>
              <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
                Tentar novamente
              </Button>
            </div>
          )}
          {url && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" onClick={print}>
                  <Printer />
                  Imprimir PDF
                </Button>
                <a
                  className={buttonVariants({ size: 'sm', variant: 'outline' })}
                  href={url}
                  download={`apmail-conversa-${threadId}.pdf`}
                >
                  <Download />
                  Baixar PDF
                </a>
                <a
                  className={buttonVariants({ size: 'sm', variant: 'ghost' })}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink />
                  Abrir PDF
                </a>
              </div>
              <p className="text-xs text-muted-foreground">
                Se a prévia não aparecer neste dispositivo, use Abrir PDF ou Baixar PDF.
              </p>
              <iframe
                ref={frame}
                src={url}
                title={subject ? `PDF da conversa: ${subject}` : 'PDF da conversa'}
                className="min-h-0 w-full flex-1 rounded-md border bg-muted"
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
