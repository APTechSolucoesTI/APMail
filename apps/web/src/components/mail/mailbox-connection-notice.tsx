import { RefreshCw } from 'lucide-react';
import type { Mailbox } from '@/lib/auth';
import { mailboxRecovering } from '@/lib/mailbox-health';
import { Button } from '@/components/ui/button';

export function MailboxConnectionNotice({
  box,
  admin,
  busy,
  onReconnect,
}: {
  box: Pick<Mailbox, 'status' | 'last_error' | 'connection_error_kind'>;
  admin: boolean;
  busy: boolean;
  onReconnect: () => void;
}) {
  if (box.status !== 'error') return null;
  const recovering = mailboxRecovering(box);
  return (
    <div
      role={recovering ? 'status' : 'alert'}
      className={
        'flex flex-col items-stretch justify-between gap-3 rounded-md border p-3 text-sm sm:flex-row sm:items-center ' +
        (recovering
          ? 'border-warning/30 bg-warning-bg text-warning-fg'
          : 'border-danger/30 bg-danger-bg text-danger-fg')
      }
    >
      <div className="min-w-0 flex-1 space-y-1">
        <p className="font-semibold">
          {recovering ? 'Restabelecendo conexão automaticamente' : 'A conexão precisa de atenção'}
        </p>
        <p>
          {recovering
            ? 'O provedor não respondeu. O APMail continuará tentando e retomará a sincronização do último ponto assim que a conexão voltar.'
            : (box.last_error ??
              'Peça ao administrador para revisar os dados e a segurança da conexão.')}
        </p>
        {!recovering && (
          <p>
            Após corrigir os dados, o sistema tentará novamente. Você também pode antecipar a
            tentativa.
          </p>
        )}
      </div>
      {admin && (
        <Button
          className="self-start sm:self-auto"
          variant="outline"
          disabled={busy}
          onClick={onReconnect}
        >
          <RefreshCw
            aria-hidden
            className={busy ? 'animate-spin motion-reduce:animate-none' : ''}
          />
          {busy ? 'Verificando…' : 'Tentar agora'}
        </Button>
      )}
    </div>
  );
}
