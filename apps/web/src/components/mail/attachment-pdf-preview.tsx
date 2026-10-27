import { useEffect, useRef, useState } from 'react';
import { LockKeyhole, Download } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingState } from '@/components/data/data-state';

/** Shares the conversation renderer; browser PDF plug-ins are blocked by the attachment sandbox. */
export function AttachmentPdfPreview({
  attachmentId,
  filename,
}: {
  attachmentId: string;
  filename: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState({ number: 0, password: undefined as string | undefined });
  const key = attachmentId + ':' + attempt.number;
  const [result, setResult] = useState<{
    key: string;
    mode: 'ready' | 'password' | 'error';
    incorrect?: boolean;
  } | null>(null);
  const current = result?.key === key ? result : null;
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(
          '/api/attachments/' + encodeURIComponent(attachmentId) + '/inline',
          { credentials: 'same-origin', signal: controller.signal },
        );
        if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf'))
          throw Error('attachment_unavailable');
        const data = await response.arrayBuffer();
        const { renderPdfPreview } = await import('@/lib/pdf-preview');
        if (controller.signal.aborted || !container.current) return;
        await renderPdfPreview(data, container.current, controller.signal, attempt.password);
        if (!controller.signal.aborted) setResult({ key, mode: 'ready' });
      } catch (error) {
        if (controller.signal.aborted) return;
        const protectedPdf = error instanceof Error && error.name === 'PasswordException';
        setResult({
          key,
          mode: protectedPdf ? 'password' : 'error',
          incorrect: protectedPdf && 'code' in error && error.code === 2,
        });
      }
    })();
    return () => controller.abort();
  }, [attachmentId, attempt.password, key]);
  return (
    <div className="min-h-0 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {current?.mode === 'ready'
            ? 'Documento pronto para visualizar.'
            : 'A senha é usada apenas para abrir esta visualização.'}
        </p>
        <a
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
          href={'/api/attachments/' + attachmentId + '/download'}
          download={filename}
        >
          <Download />
          Baixar PDF
        </a>
      </div>
      {!current && <LoadingState />}
      {current?.mode === 'password' && (
        <form
          className="mx-auto max-w-sm space-y-4 rounded-lg border bg-card p-4"
          onSubmit={(event) => {
            event.preventDefault();
            const password = new FormData(event.currentTarget).get('pdf-password');
            if (typeof password === 'string')
              setAttempt((value) => ({ number: value.number + 1, password }));
          }}
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <LockKeyhole className="size-5 text-primary" />
            PDF protegido por senha
          </div>
          <p className="text-sm text-muted-foreground">
            Use a senha informada pelo remetente para visualizar o documento. Ela não será salva no
            APMail.
          </p>
          <div className="space-y-2">
            <Label htmlFor={'pdf-password-' + attachmentId}>Senha do PDF</Label>
            <Input
              id={'pdf-password-' + attachmentId}
              name="pdf-password"
              type="password"
              autoComplete="off"
              required
              aria-invalid={current.incorrect}
            />
            {current.incorrect && (
              <p role="alert" className="text-xs text-destructive">
                Senha incorreta. Confira e tente novamente.
              </p>
            )}
          </div>
          <Button type="submit" className="h-11 w-full sm:h-8">
            Abrir documento
          </Button>
        </form>
      )}
      {current?.mode === 'error' && (
        <div role="alert" className="space-y-3 rounded-md border p-4 text-sm">
          <p>
            Não foi possível abrir o documento. A liberação pode ter sido revogada ou o arquivo pode
            estar indisponível.
          </p>
          <Button
            variant="outline"
            onClick={() => setAttempt((value) => ({ ...value, number: value.number + 1 }))}
          >
            Tentar novamente
          </Button>
        </div>
      )}
      <div
        ref={container}
        className={
          'max-h-[60dvh] overflow-y-auto rounded-md ' +
          (current?.mode === 'password' || current?.mode === 'error'
            ? 'hidden'
            : 'border bg-muted p-2 sm:p-4')
        }
        aria-label={'Páginas de ' + filename}
        aria-busy={!current}
      />
    </div>
  );
}
