import { Link } from '@tanstack/react-router';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { interruptArchiveTransfer, useArchiveTransfers } from '@/lib/mail-archive-transfers';

export function BackgroundArchiveTransfers({
  userId,
  tenantId,
}: {
  userId: string;
  tenantId: string | null;
}) {
  const transfers = useArchiveTransfers().filter(
    (t) => t.scope.userId === userId && t.scope.tenantId === tenantId && t.status !== 'received',
  );
  if (!transfers.length) return null;
  return (
    <aside
      aria-label="Envios de arquivos em segundo plano"
      className="mb-4 space-y-3 rounded-lg border bg-card p-4"
    >
      {transfers.map((t) => (
        <div key={t.scope.mailboxId} className="flex flex-wrap items-center gap-3">
          <Upload className="size-4 shrink-0 text-primary" aria-hidden />
          <div className="min-w-0 flex-1 basis-48 space-y-1">
            <p className="break-all text-sm font-semibold">{t.filename}</p>
            <p className="text-xs text-muted-foreground" role="status">
              {t.status === 'sending'
                ? `Envio em segundo plano: ${t.progress}%. Você pode fechar o painel; mantenha o APMail aberto até concluir o envio.`
                : t.error}
            </p>
            {t.status === 'sending' && (
              <progress
                aria-label={'Envio de ' + t.filename}
                className="storage-quota-bar h-2 w-full"
                max={100}
                value={t.progress}
              />
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link
                to="/settings/mailboxes/$mailboxId"
                params={{ mailboxId: t.scope.mailboxId }}
                search={{ tab: 'archives' }}
              >
                Acompanhar
              </Link>
            </Button>
            {t.status === 'sending' && (
              <Button variant="ghost" size="sm" onClick={() => interruptArchiveTransfer(t.scope)}>
                Interromper envio
              </Button>
            )}
          </div>
        </div>
      ))}
    </aside>
  );
}
