import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCheck, MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { Message } from '@/lib/mail';
export function ReadReceipt({
  message,
  canSend,
  timeZone = 'America/Sao_Paulo',
}: {
  message: Message;
  canSend: boolean;
  timeZone?: string;
}) {
  const client = useQueryClient(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const decide = async (decision: 'confirm' | 'decline') => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ decision: 'confirm' | 'decline' }>(
        '/messages/' + message.id + '/read-receipt',
        {
          method: 'POST',
          body: { decision },
        },
      );
      await client.invalidateQueries({ queryKey: ['thread'] });
      toast.success(
        result.decision === 'confirm'
          ? 'Confirmação de leitura na fila de envio.'
          : 'Sua decisão foi salva. Nenhuma confirmação será enviada.',
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível registrar sua decisão.');
    } finally {
      setBusy(false);
    }
  };
  const confirmations = message.read_receipts?.filter((r) => r.disposition === 'displayed') ?? [];
  if (message.request_read_receipt && message.direction === 'outbound')
    return (
      <div className="rounded-md border bg-muted/30 p-3 text-xs">
        <p className="flex items-center gap-2 font-medium">
          <CheckCheck className="size-4" aria-hidden />
          {confirmations.length
            ? 'Leitura confirmada'
            : 'Confirmação solicitada · Aguardando confirmação'}
        </p>
        {confirmations.map((r) => (
          <p key={r.recipient_address} className="mt-1 break-all">
            {r.recipient_address} · recebida em{' '}
            {new Date(r.received_at).toLocaleString('pt-BR', { timeZone })}
          </p>
        ))}
        <p className="mt-2 text-muted-foreground">
          Alguns clientes não retornam confirmações. A ausência de resposta não indica que a
          mensagem não foi lida.
        </p>
      </div>
    );
  if (!message.mdn_request || message.is_mdn || message.direction !== 'inbound') return null;
  if (message.mdn_decision)
    return (
      <p role="status" className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
        {message.mdn_decision.decision === 'decline'
          ? 'Você optou por não confirmar a leitura.'
          : message.mdn_decision.status === 'sent'
            ? 'Confirmação de leitura enviada.'
            : message.mdn_decision.status === 'failed'
              ? 'A confirmação não pôde ser concluída. Ela não será repetida para evitar duplicação.'
              : 'Confirmação de leitura em envio.'}
        {message.mdn_decision.status === 'failed' && message.mdn_decision.last_error && (
          <span className="mt-1 block">{message.mdn_decision.last_error}</span>
        )}
      </p>
    );
  return (
    <section
      aria-label="Pedido de confirmação de leitura"
      className="space-y-3 rounded-md border bg-secondary/50 p-3"
    >
      <p className="flex items-center gap-2 text-sm font-medium">
        <MailCheck className="size-4 shrink-0" aria-hidden />O remetente solicitou uma confirmação
        de leitura.
      </p>
      <p className="text-sm text-muted-foreground">
        Deseja informar ao remetente que você leu esta mensagem?
      </p>
      <p className="break-all text-xs text-muted-foreground">
        A confirmação será enviada para {message.mdn_request.to}.
        {!message.mdn_request.return_path_matches
          ? ' Este endereço difere do retorno do remetente ou não foi possível verificar o retorno. Confirme apenas se reconhecer o destino.'
          : ''}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy || !canSend} onClick={() => void decide('confirm')}>
          {busy ? 'Registrando…' : 'Confirmar leitura'}
        </Button>
        <Button variant="outline" size="sm" disabled={busy} onClick={() => void decide('decline')}>
          Não confirmar
        </Button>
      </div>
      {!canSend && (
        <p className="text-xs text-muted-foreground">
          Seu acesso permite leitura, mas não o envio de confirmações por esta caixa.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
