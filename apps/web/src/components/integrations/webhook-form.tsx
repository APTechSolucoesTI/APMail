import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import type { ApiMailbox } from './api-token-access';

export const webhookEventLabels = {
  'email.received': 'E-mail recebido',
  'email.sent': 'E-mail enviado',
} as const;
export type WebhookEvent = keyof typeof webhookEventLabels;
export type Webhook = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  event: WebhookEvent;
  events: WebhookEvent[];
  mailbox_ids: string[];
};
export type WebhookSecret = { id: string; name?: string; secret: string };

export function WebhookForm({
  value,
  mailboxes,
  onClose,
  onSaved,
}: {
  value: Webhook | null;
  mailboxes: ApiMailbox[];
  onClose: () => void;
  onSaved: (secret?: WebhookSecret) => Promise<void>;
}) {
  const [name, setName] = useState(value?.name ?? '');
  const [url, setUrl] = useState(value?.url ?? '');
  const [enabled, setEnabled] = useState(value?.enabled ?? false);
  const [events, setEvents] = useState<WebhookEvent[]>(
    value?.events ?? [value?.event ?? 'email.received'],
  );
  const [selected, setSelected] = useState(
    value?.mailbox_ids.filter((id) => mailboxes.some((b) => b.id === id)) ?? [],
  );
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api<WebhookSecret>(
        `/integrations/webhooks${value ? '/' + value.id : ''}`,
        {
          method: value ? 'PUT' : 'POST',
          body: { name, url, enabled, events, mailbox_ids: selected },
        },
      );
      await onSaved(value ? undefined : result);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível salvar o webhook.');
    } finally {
      setBusy(false);
    }
  }
  const boxes = mailboxes.filter((b) =>
    `${b.name} ${b.email_address}`.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{value ? 'Editar webhook' : 'Criar webhook'}</DialogTitle>
          <DialogDescription>
            Envie eventos das caixas monitoradas para o servidor da sua integração.
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={save}>
          <div className="space-y-2">
            <Label htmlFor="webhook-name">Nome da integração</Label>
            <Input
              id="webhook-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              required
              placeholder="Escreva o nome da sua integração aqui…"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="webhook-url">URL de destino</Label>
            <Input
              id="webhook-url"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              maxLength={2048}
              required
              placeholder="https://seu-sistema.com.br/webhooks/apmail"
            />
            <p className="text-xs text-muted-foreground">
              HTTPS público na porta 443. Endereços internos e redirecionamentos são bloqueados.
            </p>
          </div>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">Eventos</legend>
            {(Object.keys(webhookEventLabels) as WebhookEvent[]).map((event) => (
              <label key={event} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={events.includes(event)}
                  onChange={(e) =>
                    setEvents((current) =>
                      e.target.checked
                        ? [...current, event]
                        : current.filter((item) => item !== event),
                    )
                  }
                />
                {webhookEventLabels[event]}{' '}
                <code className="text-xs text-muted-foreground">{event}</code>
              </label>
            ))}
          </fieldset>
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">
              Caixas monitoradas ({selected.length})
            </legend>
            <p className="text-xs text-muted-foreground">
              Somente caixas que você administra. O webhook recebe o conteúdo dos e-mails destas
              caixas, sem precisar de token de API.
            </p>
            <Input
              aria-label="Pesquisar caixas monitoradas"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nome ou e-mail"
            />
            <div className="max-h-48 overflow-y-auto rounded-md border p-2">
              {boxes.map((b) => (
                <label
                  key={b.id}
                  className="flex min-h-11 cursor-pointer items-center gap-2 rounded p-2 text-sm hover:bg-muted"
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(b.id)}
                    onChange={(e) =>
                      setSelected((current) =>
                        e.target.checked ? [...current, b.id] : current.filter((id) => id !== b.id),
                      )
                    }
                  />
                  <span className="min-w-0 break-words">
                    {b.name}
                    <span className="block text-xs text-muted-foreground">{b.email_address}</span>
                  </span>
                </label>
              ))}
              {!boxes.length && (
                <p role="status" className="p-2 text-sm text-muted-foreground">
                  Nenhuma caixa disponível.
                </p>
              )}
            </div>
          </fieldset>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            Webhook ativo
          </label>
          {value && (
            <p className="text-xs text-muted-foreground">
              Salvar alterações cancela entregas ainda pendentes da configuração anterior. O
              histórico permanece disponível.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancelar
            </Button>
            <Button disabled={busy || !selected.length || !events.length}>
              {busy ? 'Salvando…' : 'Salvar webhook'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
