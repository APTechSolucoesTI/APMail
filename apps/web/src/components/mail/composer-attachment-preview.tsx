import { ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useState } from 'react';
import { attachmentCanOpen, antivirusExplanation, type AttachmentSecurity } from '@/lib/antivirus';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { AttachmentPdfPreview } from './attachment-pdf-preview';
import { AttachmentSafetyBadge } from './attachment-safety';
import type { OutboxAttachment } from '@apmail/shared';

export function ComposerAttachmentPreview({
  file,
  security,
  index,
  count,
  onNavigate,
  onClose,
  onCloseAutoFocus,
}: {
  file: { ref: OutboxAttachment; filename: string; content_type?: string };
  security: AttachmentSecurity | undefined;
  index: number;
  count: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const ref = file.ref;
  const upload = ref.source === 'upload';
  const id = upload ? ref.upload_id : ref.attachment_id;
  const base = '/api/' + (upload ? 'uploads/' : 'attachments/') + encodeURIComponent(id);
  const inlineUrl = base + (upload ? '/preview' : '/inline');
  const downloadUrl = base + '/download';
  const pdf = file.content_type === 'application/pdf';
  const image = /^image\/(png|jpeg|gif|webp)$/.test(file.content_type ?? '');
  const allowed = attachmentCanOpen(security);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="pr-6">
          <DialogTitle className="break-words">{file.filename}</DialogTitle>
          <DialogDescription>Visualização de anexos do rascunho</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <AttachmentSafetyBadge security={security} />
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              aria-label="Anexo anterior"
              disabled={index === 0}
              onClick={() => onNavigate(index - 1)}
            >
              <ChevronLeft />
            </Button>
            <span aria-live="polite" className="text-sm tabular-nums">
              {index + 1} de {count}
            </span>
            <Button
              variant="outline"
              size="icon"
              aria-label="Próximo anexo"
              disabled={index + 1 === count}
              onClick={() => onNavigate(index + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
        {!allowed ? (
          <p role="status" className="text-sm text-muted-foreground">
            {antivirusExplanation(security)}
          </p>
        ) : pdf ? (
          <AttachmentPdfPreview
            key={base}
            attachmentId={id}
            filename={file.filename}
            source={{ inlineUrl, downloadUrl }}
          />
        ) : (
          <>
            {image ? (
              <PreviewImage key={base} src={inlineUrl} filename={file.filename} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Prévia indisponível para este formato. Você pode baixar o arquivo.
              </p>
            )}
            <div className="flex justify-end">
              <a
                className={buttonVariants({ variant: 'outline' })}
                href={downloadUrl}
                download={file.filename}
              >
                <Download />
                Baixar anexo
              </a>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function PreviewImage({ src, filename }: { src: string; filename: string }) {
  const [status, setStatus] = useState<'loading' | 'loaded' | 'failed'>('loading');
  if (status === 'failed')
    return (
      <p role="alert" className="text-sm text-destructive">
        Não foi possível abrir a imagem. Confira a verificação do arquivo e tente novamente.
      </p>
    );
  return (
    <>
      {status === 'loading' && (
        <p role="status" className="text-sm text-muted-foreground">
          Carregando imagem…
        </p>
      )}
      <img
        src={src}
        alt={filename}
        onLoad={() => setStatus('loaded')}
        onError={() => setStatus('failed')}
        className="mx-auto max-h-[55dvh] max-w-full rounded-md object-contain"
      />
    </>
  );
}
