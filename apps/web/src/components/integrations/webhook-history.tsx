import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/data/data-state';
import type { Webhook } from './webhook-form';

type Delivery = {
  id: string;
  event_key: string;
  event_type: string;
  is_test: boolean;
  state: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_status: number | null;
  last_error: string | null;
  created_at: string;
  delivered_at: string | null;
  history: {
    number: number;
    started_at: string;
    finished_at: string | null;
    http_status: number | null;
    error_code: string | null;
  }[];
};
const states: Record<string, string> = {
  pending: 'Aguardando',
  delivering: 'Enviando',
  retry: 'Nova tentativa agendada',
  delivered: 'Entregue',
  failed: 'Falhou',
  cancelled: 'Cancelada',
};
const errors: Record<string, string> = {
  destination_blocked: 'Destino bloqueado por segurança',
  configuration_changed: 'Configuração alterada',
  message_unavailable: 'Mensagem indisponível',
  transport_error: 'Não foi possível conectar ao destino',
  timeout: 'Tempo de resposta excedido',
  dns_timeout: 'Tempo de consulta do endereço excedido',
  lease_expired: 'Processamento interrompido',
  payload_too_large: 'Conteúdo excede o limite de envio',
};
function reason(code: string | null) {
  return code?.startsWith('http_')
    ? 'O destino respondeu HTTP ' + code.slice(5)
    : code
      ? (errors[code] ?? 'Falha na entrega')
      : null;
}
const date = (value: string) => new Date(value).toLocaleString('pt-BR');

export function WebhookHistory({ webhook, onClose }: { webhook: Webhook; onClose: () => void }) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    [page, setPage] = useState(1),
    [busy, setBusy] = useState<string | null>(null);
  const key = ['webhook-deliveries', tenant, webhook.id, page];
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      api<{ items: Delivery[]; total: number; page: number; pageSize: number }>(
        `/integrations/webhooks/${webhook.id}/deliveries?page=${page}`,
      ),
    refetchInterval: 5000,
  });
  async function retry(id: string) {
    setBusy(id);
    try {
      await api(`/integrations/webhooks/${webhook.id}/deliveries/${id}/retry`, {
        method: 'POST',
        body: {},
      });
      await client.invalidateQueries({ queryKey: ['webhook-deliveries', tenant, webhook.id] });
      toast.success('Reenvio agendado.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível reenviar.');
    } finally {
      setBusy(null);
    }
  }
  const total = query.data?.total ?? 0,
    pages = Math.max(1, Math.ceil(total / 25));
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Histórico de entregas</DialogTitle>
          <DialogDescription>
            {webhook.name}. Cada entrega registra as tentativas e a resposta do destino.
          </DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : !query.data.items.length ? (
          <EmptyState
            title="Nenhuma entrega"
            description="Envie um teste ou aguarde um novo e-mail nas caixas monitoradas."
          />
        ) : (
          <div className="space-y-3">
            {query.data.items.map((d) => (
              <article key={d.id} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={d.state === 'failed' ? 'destructive' : 'outline'}>
                      {states[d.state] ?? d.state}
                    </Badge>
                    {d.is_test && <Badge variant="secondary">Teste</Badge>}
                    <span className="text-xs text-muted-foreground">{date(d.created_at)}</span>
                  </div>
                  {['failed', 'cancelled'].includes(d.state) && (webhook.enabled || d.is_test) && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!!busy}
                      onClick={() => retry(d.id)}
                    >
                      <RotateCw />
                      {busy === d.id ? 'Agendando…' : 'Reenviar'}
                    </Button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {d.event_type ?? 'email.received'} · {d.attempts} de {d.max_attempts} tentativas
                  {d.last_status ? ` · HTTP ${d.last_status}` : ''}
                </p>
                {d.last_error && <p className="text-sm text-destructive">{reason(d.last_error)}</p>}
                {d.state === 'retry' && (
                  <p className="text-xs text-muted-foreground">
                    Próxima tentativa: {date(d.next_attempt_at)}
                  </p>
                )}
                <details className="text-xs">
                  <summary className="cursor-pointer py-1 text-muted-foreground">
                    Ver tentativas e identificador
                  </summary>
                  <p className="break-all py-2 font-mono">{d.event_key}</p>
                  <ol className="space-y-1">
                    {d.history.map((a) => (
                      <li key={a.number}>
                        {a.number}. {date(a.started_at)} ·{' '}
                        {a.http_status
                          ? `HTTP ${a.http_status}`
                          : a.finished_at
                            ? 'Encerrada'
                            : 'Em andamento'}
                        {a.error_code ? ` · ${reason(a.error_code)}` : ''}
                      </li>
                    ))}
                  </ol>
                </details>
              </article>
            ))}
          </div>
        )}
        <nav
          className="flex items-center justify-between gap-2"
          aria-label="Paginação das entregas"
        >
          <span className="text-xs text-muted-foreground">
            {total
              ? `${(page - 1) * 25 + 1}–${Math.min(page * 25, total)} de ${total}`
              : '0 entregas'}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="icon"
              variant="outline"
              aria-label="Página anterior"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft />
            </Button>
            <span className="text-xs">
              {page} de {pages}
            </span>
            <Button
              size="icon"
              variant="outline"
              aria-label="Próxima página"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight />
            </Button>
          </div>
        </nav>
      </DialogContent>
    </Dialog>
  );
}
