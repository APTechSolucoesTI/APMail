import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Ellipsis,
  History,
  Pause,
  Play,
  Plus,
  RotateCw,
  Send,
  Trash2,
  Webhook as WebhookIcon,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { EmptyState, ErrorState, LoadingState } from '@/components/data/data-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import type { ApiMailbox } from './api-token-access';
import { WebhookForm, type Webhook, type WebhookSecret } from './webhook-form';
import { WebhookHistory } from './webhook-history';

export function Webhooks() {
  const tenant = useTenantId();
  return <TenantWebhooks key={tenant} />;
}
function TenantWebhooks() {
  const tenant = useTenantId(),
    client = useQueryClient(),
    key = ['integration-webhooks', tenant];
  const query = useQuery({
    queryKey: key,
    queryFn: () => api<{ webhooks: Webhook[]; mailboxes: ApiMailbox[] }>('/integrations/webhooks'),
  });
  const [form, setForm] = useState<Webhook | null | undefined>(undefined),
    [history, setHistory] = useState<Webhook | null>(null),
    [secret, setSecret] = useState<WebhookSecret | null>(null);
  const [action, setAction] = useState<{ webhook: Webhook; kind: 'delete' | 'rotate' } | null>(
      null,
    ),
    [busy, setBusy] = useState<string | null>(null);
  const refresh = () => client.invalidateQueries({ queryKey: key });
  async function run(w: Webhook, kind: 'toggle' | 'test') {
    setBusy(w.id);
    try {
      await api(`/integrations/webhooks/${w.id}${kind === 'test' ? '/test' : ''}`, {
        method: kind === 'test' ? 'POST' : 'PUT',
        body:
          kind === 'test'
            ? {}
            : {
                name: w.name,
                url: w.url,
                event: w.event,
                mailbox_ids: w.mailbox_ids,
                enabled: !w.enabled,
              },
      });
      toast.success(
        kind === 'test'
          ? 'Teste agendado. Acompanhe o resultado no histórico.'
          : w.enabled
            ? 'Webhook desativado.'
            : 'Webhook ativado.',
      );
      if (kind === 'test') setHistory(w);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível concluir a ação.');
    } finally {
      setBusy(null);
    }
  }
  async function confirm() {
    if (!action) return;
    const { webhook: w, kind } = action;
    if (kind === 'rotate')
      setSecret({
        ...(await api<WebhookSecret>(`/integrations/webhooks/${w.id}/secret`, {
          method: 'POST',
          body: {},
        })),
        name: w.name,
      });
    else {
      await api(`/integrations/webhooks/${w.id}`, { method: 'DELETE' });
      toast.success('Webhook excluído.');
    }
    await refresh();
    setAction(null);
  }
  return (
    <div className="space-y-4">
      <PageHeader
        title="Integrações"
        description="Receba eventos do APMail no servidor dos seus sistemas."
      />
      <section className="space-y-4 rounded-lg border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <WebhookIcon className="size-4" />
              Webhooks
            </h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Configure o destino, as caixas monitoradas e a assinatura de segurança. Webhooks
              funcionam independentemente dos tokens de API.
            </p>
          </div>
          <Button disabled={!query.data} onClick={() => setForm(null)}>
            <Plus />
            Criar webhook
          </Button>
        </div>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState onRetry={() => query.refetch()} />
        ) : !query.data.webhooks.length ? (
          <EmptyState
            icon={WebhookIcon}
            title="Nenhum webhook cadastrado"
            description="Crie um webhook para receber eventos de novos e-mails."
          />
        ) : (
          <ul className="divide-y">
            {query.data.webhooks.map((w) => (
              <li key={w.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{w.name}</span>
                    <Badge variant="outline">{w.enabled ? 'Ativo' : 'Desativado'}</Badge>
                  </div>
                  <p className="break-all text-xs text-muted-foreground">{w.url}</p>
                  <p className="text-xs text-muted-foreground">
                    email.received · {w.mailbox_ids.length}{' '}
                    {w.mailbox_ids.length === 1 ? 'caixa monitorada' : 'caixas monitoradas'}
                  </p>
                  <p className="break-words text-xs text-muted-foreground">
                    {query.data.mailboxes
                      .filter((b) => w.mailbox_ids.includes(b.id))
                      .map((b) => b.name)
                      .join(', ')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy === w.id}
                    onClick={() => setForm(w)}
                  >
                    <Pencil />
                    Editar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setHistory(w)}>
                    <History />
                    Histórico
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        disabled={busy === w.id}
                        aria-label={`Mais ações de ${w.name}`}
                      >
                        <Ellipsis />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => void run(w, 'toggle')}>
                        {w.enabled ? <Pause /> : <Play />}
                        {w.enabled ? 'Desativar' : 'Ativar'}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void run(w, 'test')}>
                        <Send />
                        Testar envio
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setAction({ webhook: w, kind: 'rotate' })}>
                        <RotateCw />
                        Gerar novo segredo
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setAction({ webhook: w, kind: 'delete' })}
                      >
                        <Trash2 />
                        Excluir webhook
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      {form !== undefined && query.data && (
        <WebhookForm
          value={form}
          mailboxes={query.data.mailboxes}
          onClose={() => setForm(undefined)}
          onSaved={async (value) => {
            if (value) setSecret(value);
            await refresh();
            toast.success('Webhook salvo.');
          }}
        />
      )}
      {history && (
        <WebhookHistory key={history.id} webhook={history} onClose={() => setHistory(null)} />
      )}
      <Dialog open={!!secret} onOpenChange={(open) => !open && setSecret(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Segredo de assinatura gerado</DialogTitle>
            <DialogDescription>
              Copie agora para o servidor que receberá os eventos. Este segredo não será exibido
              novamente e não é um token de API.
            </DialogDescription>
          </DialogHeader>
          <Label htmlFor="webhook-secret">{secret?.name ?? 'Segredo HMAC'}</Label>
          <Input
            id="webhook-secret"
            readOnly
            value={secret?.secret ?? ''}
            className="font-mono"
            onFocus={(e) => e.target.select()}
          />
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setSecret(null)}>
              Fechar
            </Button>
            <Button
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(secret!.secret);
                  toast.success('Segredo copiado.');
                } catch {
                  toast.error('Selecione o segredo e copie usando o teclado.');
                }
              }}
            >
              <Copy />
              Copiar segredo
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!action}
        onOpenChange={(open) => !open && setAction(null)}
        title={action?.kind === 'delete' ? 'Excluir webhook?' : 'Gerar novo segredo?'}
        description={
          action?.kind === 'delete'
            ? 'O webhook, as entregas pendentes e seu histórico serão excluídos. Nenhum e-mail será removido.'
            : 'O segredo anterior deixará de ser usado e as entregas pendentes serão canceladas. Atualize o segredo no sistema de destino.'
        }
        destructive
        onConfirm={confirm}
      />
    </div>
  );
}
