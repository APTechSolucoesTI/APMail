import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, Mail, RotateCcw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAccess, useTenantId } from '@/lib/auth';
import { formatStorageBytes } from '@/lib/storage-metering';
import { PageHeader } from '@/components/layout/page-header';
import { EmptyState, ErrorState, LoadingState } from '@/components/data/data-state';
import { Pagination } from '@/components/data/pagination';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

type RetainedMail = {
  id: string;
  subject: string;
  deleted_at: string;
  retention_expires_at: string;
  retention_purge_requested_at: string | null;
  retention_last_error: string | null;
  pending_action: boolean;
  mailbox_name: string;
  mailbox_email: string;
  deleted_by: string | null;
};
type Address = { name: string; address: string };
type Detail = {
  subject: string;
  body_text: string;
  from_name: string;
  from_address: string;
  to_addresses: Address[];
  cc_addresses: Address[];
  bcc_addresses: Address[];
  message_at: string;
  has_original: boolean;
  attachments: { id: string; filename: string; size_bytes: number }[];
};
type FilterOptions = {
  mailboxes: { id: string; name: string; email_address: string }[];
  users: { id: string; full_name: string }[];
};
type Filter = { q: string; mailbox_id: string; user_id: string; from: string; to: string };
type PurgeTarget =
  { scope: 'message'; id: string; subject: string } | { scope: 'all'; expected_count: number };
const initial: Filter = { q: '', mailbox_id: '', user_id: '', from: '', to: '' };
const selectClass =
  'h-9 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:ring-2 focus-visible:ring-ring';

export function MailRetentionPanel() {
  const tenant = useTenantId();
  const client = useQueryClient();
  const mayPurge = useAccess('retention.purge');
  const [draft, setDraft] = useState(initial);
  const [filter, setFilter] = useState(initial);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<RetainedMail | null>(null);
  const [restore, setRestore] = useState<RetainedMail | null>(null);
  const [purge, setPurge] = useState<PurgeTarget | null>(null);
  const options = useQuery({
    queryKey: ['mail-retention', tenant, 'filters'],
    queryFn: () => api<FilterOptions>('/mail-retention/filters'),
  });
  const result = useQuery({
    queryKey: ['mail-retention', tenant, filter, page],
    queryFn: () => {
      const query = new URLSearchParams({ page: String(page) });
      for (const [key, value] of Object.entries(filter))
        if (value.trim()) query.set(key, value.trim());
      return api<{
        items: RetainedMail[];
        total: number;
        purgeable_count: number;
        timezone: string;
      }>('/mail-retention?' + query);
    },
    refetchInterval: 30000,
  });
  const data = result.data;
  const format = (date: string) =>
    new Date(date).toLocaleString('pt-BR', { timeZone: data?.timezone });
  const refresh = async () => {
    setPage(1);
    await client.invalidateQueries({ queryKey: ['mail-retention', tenant] });
  };
  const purgeCount = data?.purgeable_count ?? 0;
  return (
    <div className="space-y-4">
      <PageHeader
        title="E-mails em retenção"
        description="Consulte e recupere mensagens removidas da Lixeira da empresa."
        actions={
          mayPurge && purgeCount > 0 ? (
            <Button
              variant="outline"
              className="text-destructive"
              onClick={() => setPurge({ scope: 'all', expected_count: purgeCount })}
            >
              <Trash2 /> Excluir todos ({purgeCount})
            </Button>
          ) : undefined
        }
      />
      <form
        className="grid items-end gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2 xl:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter(draft);
          setPage(1);
        }}
      >
        <div className="space-y-1.5">
          <Label htmlFor="retention-subject">Assunto</Label>
          <Input
            id="retention-subject"
            maxLength={200}
            value={draft.q}
            onChange={(event) => setDraft({ ...draft, q: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="retention-mailbox">Caixa</Label>
          <select
            id="retention-mailbox"
            className={selectClass}
            value={draft.mailbox_id}
            onChange={(event) => setDraft({ ...draft, mailbox_id: event.target.value })}
          >
            <option value="">Todas</option>
            {options.data?.mailboxes.map((box) => (
              <option key={box.id} value={box.id}>
                {box.name} · {box.email_address}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="retention-actor">Excluído por</Label>
          <select
            id="retention-actor"
            className={selectClass}
            value={draft.user_id}
            onChange={(event) => setDraft({ ...draft, user_id: event.target.value })}
          >
            <option value="">Todos</option>
            {options.data?.users.map((user) => (
              <option key={user.id} value={user.id}>
                {user.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="retention-from">Exclusão a partir de</Label>
          <Input
            id="retention-from"
            type="date"
            max={draft.to || undefined}
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="retention-to">Exclusão até</Label>
          <Input
            id="retention-to"
            type="date"
            min={draft.from || undefined}
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm">
            Filtrar
          </Button>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() => {
              setDraft(initial);
              setFilter(initial);
              setPage(1);
            }}
          >
            Limpar
          </Button>
        </div>
        {options.isError && (
          <p role="alert" className="text-sm text-destructive sm:col-span-2">
            Filtros de caixa e usuário indisponíveis.{' '}
            <button type="button" className="underline" onClick={() => void options.refetch()}>
              Tentar novamente
            </button>
          </p>
        )}
      </form>

      <section
        className="overflow-hidden rounded-lg border bg-card"
        aria-label="Mensagens em retenção"
        aria-busy={result.isFetching}
      >
        {result.isPending ? (
          <LoadingState />
        ) : result.isError ? (
          <ErrorState onRetry={() => void result.refetch()} />
        ) : !data?.items.length ? (
          <EmptyState
            icon={Mail}
            title="Nenhum e-mail encontrado"
            description="As mensagens removidas da Lixeira aparecerão aqui até o fim da retenção."
            action={
              page > 1 ? (
                <Button variant="outline" onClick={() => setPage(1)}>
                  Voltar à primeira página
                </Button>
              ) : undefined
            }
          />
        ) : (
          <>
            <ul className="divide-y">
              {data.items.map((message) => (
                <li
                  key={message.id}
                  className="grid gap-2 px-4 py-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-center"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold" title={message.subject}>
                      {message.subject || '(Sem assunto)'}
                    </p>
                    <p
                      className="truncate text-xs text-muted-foreground"
                      title={message.mailbox_email}
                    >
                      {message.mailbox_name} · {message.mailbox_email}
                    </p>
                    {message.pending_action && (
                      <Badge variant="secondary" className="mt-1">
                        Sincronizando exclusão
                      </Badge>
                    )}
                    {message.retention_purge_requested_at && (
                      <Badge variant="secondary" className="mt-1">
                        Exclusão definitiva solicitada
                      </Badge>
                    )}
                    {message.retention_last_error && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {message.retention_last_error}
                      </p>
                    )}
                  </div>
                  <div className="space-y-0.5 text-xs text-muted-foreground">
                    <p>
                      Excluído por {message.deleted_by ?? 'Usuário indisponível'} em{' '}
                      {format(message.deleted_at)}
                    </p>
                    <p>Exclusão prevista para {format(message.retention_expires_at)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button variant="ghost" size="sm" onClick={() => setDetail(message)}>
                      <Eye /> Visualizar
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={message.pending_action || !!message.retention_purge_requested_at}
                      onClick={() => setRestore(message)}
                    >
                      <RotateCcw /> Restaurar
                    </Button>
                    {mayPurge && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={!!message.retention_purge_requested_at}
                        onClick={() =>
                          setPurge({ scope: 'message', id: message.id, subject: message.subject })
                        }
                      >
                        <Trash2 /> Excluir
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="border-t">
              <Pagination page={page} pageSize={25} total={data.total} onPageChange={setPage} />
            </div>
          </>
        )}
      </section>
      {detail && (
        <RetentionDetail id={detail.id} timezone={data?.timezone} onClose={() => setDetail(null)} />
      )}
      <ConfirmDialog
        open={!!restore}
        onOpenChange={(open) => {
          if (!open) setRestore(null);
        }}
        title="Restaurar este e-mail?"
        description="A cópia será restaurada na caixa original do APMail, em Caixa de entrada ou Enviados."
        onConfirm={async () => {
          if (!restore) return;
          await api('/mail-retention/' + restore.id + '/restore', { method: 'POST' });
          for (const key of ['threads', 'thread', 'folders', 'queue-counts'])
            void client.invalidateQueries({ queryKey: [key] });
          await refresh();
          toast.success('E-mail restaurado.');
        }}
      />
      {purge && <PurgeDialog target={purge} onClose={() => setPurge(null)} onQueued={refresh} />}
    </div>
  );
}

function RetentionDetail({
  id,
  timezone,
  onClose,
}: {
  id: string;
  timezone?: string;
  onClose: () => void;
}) {
  const tenant = useTenantId();
  const query = useQuery({
    queryKey: ['mail-retention', tenant, 'detail', id],
    queryFn: () => api<Detail>('/mail-retention/' + id),
  });
  const message = query.data;
  const addressList = (addresses: Address[]) => addresses.map((item) => item.address).join(', ');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="break-words">
            {message?.subject || 'E-mail em retenção'}
          </DialogTitle>
          <DialogDescription>Conteúdo recuperável da mensagem excluída.</DialogDescription>
        </DialogHeader>
        {query.isPending ? (
          <LoadingState />
        ) : query.isError ? (
          <ErrorState onRetry={() => void query.refetch()} />
        ) : (
          message && (
            <>
              <div className="space-y-1 break-words rounded-md bg-muted p-3 text-sm">
                <p>
                  De {message.from_name} &lt;{message.from_address}&gt;
                </p>
                <p>Para {addressList(message.to_addresses)}</p>
                {message.cc_addresses.length > 0 && <p>Cc {addressList(message.cc_addresses)}</p>}
                {message.bcc_addresses.length > 0 && (
                  <p>Cco {addressList(message.bcc_addresses)}</p>
                )}
                <p className="text-muted-foreground">
                  {new Date(message.message_at).toLocaleString('pt-BR', { timeZone: timezone })}
                </p>
              </div>
              {(message.attachments.length > 0 || message.has_original) && (
                <div className="flex flex-wrap gap-2">
                  {message.attachments.map((item) => (
                    <Button
                      key={item.id}
                      variant="outline"
                      size="sm"
                      className="max-w-full"
                      asChild
                    >
                      <a
                        href={'/api/mail-retention/' + id + '/attachments/' + item.id}
                        target="_blank"
                        rel="noopener noreferrer"
                        title={item.filename}
                      >
                        <Download /> <span className="truncate">{item.filename}</span>
                        <span className="text-xs text-muted-foreground">
                          {formatStorageBytes(String(item.size_bytes))}
                        </span>
                      </a>
                    </Button>
                  ))}
                  {message.has_original && (
                    <Button variant="outline" size="sm" asChild>
                      <a
                        href={'/api/mail-retention/' + id + '/original'}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download /> Mensagem original
                      </a>
                    </Button>
                  )}
                </div>
              )}
              <div className="whitespace-pre-wrap break-words rounded-md border p-3 text-sm">
                {message.body_text || 'Mensagem sem texto disponível.'}
              </div>
            </>
          )
        )}
      </DialogContent>
    </Dialog>
  );
}

function PurgeDialog({
  target,
  onClose,
  onQueued,
}: {
  target: PurgeTarget;
  onClose: () => void;
  onQueued: () => Promise<void>;
}) {
  const [confirmation, setConfirmation] = useState('');
  const operation = useMutation({
    mutationFn: () =>
      api<{ queued: number }>('/mail-retention/purge', {
        method: 'POST',
        body:
          target.scope === 'all'
            ? { scope: target.scope, expected_count: target.expected_count, confirmation }
            : { scope: target.scope, id: target.id, confirmation },
      }),
    onSuccess: (result) => {
      toast.success(
        'Exclusão definitiva solicitada para ' +
          result.queued +
          (result.queued === 1 ? ' e-mail.' : ' e-mails.'),
      );
      onClose();
      void onQueued();
    },
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !operation.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={!operation.isPending}>
        <DialogHeader>
          <DialogTitle>Confirmar exclusão definitiva</DialogTitle>
          <DialogDescription>
            {target.scope === 'all'
              ? 'Você está solicitando a exclusão de ' +
                target.expected_count +
                ' e-mails em retenção da empresa, incluindo os que estão fora deste filtro.'
              : 'O e-mail “' +
                (target.subject || '(Sem assunto)') +
                '” será excluído definitivamente.'}{' '}
            Após a limpeza, a mensagem e os anexos ficam indisponíveis para recuperação.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (confirmation === 'EXCLUIR' && !operation.isPending) operation.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="retention-confirmation">Digite EXCLUIR para confirmar</Label>
            <Input
              id="retention-confirmation"
              autoComplete="off"
              value={confirmation}
              disabled={operation.isPending}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </div>
          {operation.isError && (
            <p role="alert" className="text-sm text-destructive">
              {operation.error.message}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={operation.isPending}
              onClick={onClose}
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={confirmation !== 'EXCLUIR' || operation.isPending}
            >
              {operation.isPending ? 'Solicitando…' : 'Excluir definitivamente'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
