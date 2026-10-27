import { useEffect, useRef, useState } from 'react';
import { Download, ExternalLink, LoaderCircle, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { MailActionButton } from './mail-action-button';
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
  const [result, setResult] = useState<{
    key: string;
    url: string | null;
    error: boolean;
    ready?: boolean;
  } | null>(null);
  const requestKey = `${threadId}:${attempt}`;
  const current = result?.key === requestKey ? result : null;
  const url = current?.url ?? null;
  const error = current?.error ?? false;
  const preview = useRef<HTMLDivElement>(null);
  const [printing, setPrinting] = useState(false);
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
        const { renderPdfPreview } = await import('@/lib/pdf-preview');
        if (controller.signal.aborted || !preview.current) return;
        await renderPdfPreview(await blob.arrayBuffer(), preview.current, controller.signal);
        if (!controller.signal.aborted)
          setResult({ key: requestKey, url: objectUrl, error: false, ready: true });
      } catch {
        if (!controller.signal.aborted) setResult({ key: requestKey, url: null, error: true });
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [open, threadId, requestKey]);

  const print = async () => {
    if (!preview.current || printing) return;
    setPrinting(true);
    try {
      const { printPdfPages } = await import('@/lib/pdf-preview');
      await printPdfPages(preview.current, subject ?? 'Conversa APMail');
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Não foi possível abrir a impressão. Tente novamente.',
      );
    } finally {
      setPrinting(false);
    }
  };
  return (
    <>
      <MailActionButton
        label="Imprimir conversa"
        text="Imprimir"
        onClick={() => {
          setAttempt((value) => value + 1);
          setOpen(true);
        }}
      >
        <Printer />
      </MailActionButton>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex h-[90dvh] max-h-[960px] flex-col sm:max-w-5xl">
          <DialogHeader className="pr-7">
            <DialogTitle>Imprimir conversa</DialogTitle>
            <DialogDescription>
              Todas as mensagens às quais você tem acesso, em ordem cronológica, com os nomes e
              identificadores dos anexos.
            </DialogDescription>
          </DialogHeader>
          {!current?.ready && !error && (
            <div
              role="status"
              className="flex items-center justify-center gap-2 py-3 text-sm text-muted-foreground"
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
          {url && !error && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  disabled={!current?.ready || printing}
                  onClick={() => void print()}
                >
                  <Printer />
                  {printing ? 'Abrindo impressão…' : 'Imprimir PDF'}
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
            </>
          )}
          <div
            ref={preview}
            role="region"
            aria-label="Prévia do PDF da conversa"
            aria-busy={!current?.ready && !error}
            className="min-h-0 flex-1 overflow-auto rounded-md border bg-muted p-3"
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
