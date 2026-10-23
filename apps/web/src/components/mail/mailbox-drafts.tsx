import { useEffect, useId, useState } from 'react';
import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { FilePenLine, Paperclip, RefreshCw, Trash2 } from 'lucide-react';
import type { Address } from '@apmail/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId, meQuery } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/data/search-input';
import { Pagination } from '@/components/data/pagination';
import { LoadingState, ErrorState, EmptyState } from '@/components/data/data-state';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import type { MailSearch } from '@/lib/search-params/mail';

type Draft = {
  id: string;
  source: 'draft' | 'message';
  thread_id: string | null;
  subject: string;
  to_addresses: Address[];
  snippet: string;
  updated_at: string;
  has_attachments: boolean;
  can_edit: boolean;
};
type Search = Pick<MailSearch, 'q' | 'page' | 'pageSize'>;
export function MailboxDrafts({
  mailboxId,
  search,
  onChange,
  onOpenDraft,
  onOpenMessage,
}: {
  mailboxId: string;
  search: Search;
  onChange: (patch: Partial<Search>) => void;
  onOpenDraft: (id: string) => void;
  onOpenMessage: (thread: string, message: string) => void;
}) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    me = useQuery(meQuery);
  const pageSizeId = useId();
  const [removing, setRemoving] = useState<Draft | null>(null);
  const params = new URLSearchParams({
    page: String(search.page),
    page_size: String(search.pageSize),
  });
  if (search.q) params.set('q', search.q);
  const drafts = useQuery({
    queryKey: ['outbox', tenant, 'mailbox-drafts', mailboxId, params.toString()],
    queryFn: () =>
      api<{ items: Draft[]; total: number }>('/mailboxes/' + mailboxId + '/drafts?' + params),
    placeholderData: keepPreviousData,
  });
  useEffect(() => {
    if (!drafts.data || drafts.isFetching || drafts.isPlaceholderData) return;
    const last = Math.max(1, Math.ceil(drafts.data.total / search.pageSize));
    if (search.page > last) onChange({ page: last });
  }, [
    drafts.data,
    drafts.isFetching,
    drafts.isPlaceholderData,
    search.page,
    search.pageSize,
    onChange,
  ]);
  const pagination = (
    <Pagination
      page={search.page}
      pageSize={search.pageSize}
      total={drafts.data?.total ?? 0}
      onPageChange={(page) => onChange({ page })}
    />
  );
  return (
    <section aria-label="Rascunhos da caixa" className="flex h-full min-w-0 flex-col bg-card">
      <div className="flex items-center gap-2 border-b p-3">
        <SearchInput
          className="min-w-0 flex-1"
          value={search.q ?? ''}
          placeholder="Buscar rascunhos…"
          debounce={300}
          onChange={(q) => onChange({ q: q || undefined, page: 1 })}
        />
        <Button
          size="icon-sm"
          variant="outline"
          aria-label="Atualizar rascunhos"
          className="size-11 shrink-0 sm:size-8"
          disabled={drafts.isFetching}
          onClick={() => void drafts.refetch()}
        >
          <RefreshCw
            className={drafts.isFetching ? 'animate-spin motion-reduce:animate-none' : ''}
          />
        </Button>
      </div>
      <div className="flex items-center justify-end gap-2 border-b px-3 py-2 text-xs">
        <label htmlFor={pageSizeId}>Por página</label>
        <select
          id={pageSizeId}
          aria-label="Rascunhos por página"
          value={search.pageSize}
          className="h-11 rounded-md border border-input bg-card px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:h-8"
          onChange={(e) =>
            onChange({ pageSize: Number(e.target.value) as Search['pageSize'], page: 1 })
          }
        >
          {[10, 20, 30, 50, 100].map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
      {pagination}
      <div className="min-h-0 flex-1 overflow-y-auto" aria-busy={drafts.isFetching}>
        {drafts.isPending ? (
          <LoadingState />
        ) : drafts.isError ? (
          <ErrorState onRetry={() => void drafts.refetch()} />
        ) : !drafts.data.items.length ? (
          <EmptyState
            icon={FilePenLine}
            title={search.q ? 'Nenhum rascunho encontrado' : 'Nenhum rascunho nesta caixa'}
            description="Os e-mails que você salvar antes de enviar aparecerão aqui."
          />
        ) : (
          drafts.data.items.map((draft) => (
            <div
              key={draft.source + draft.id}
              className="flex min-w-0 items-start border-b hover:bg-muted/50"
            >
              <button
                type="button"
                className="min-w-0 flex-1 space-y-1 p-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-default"
                aria-label={
                  (draft.source === 'draft' ? 'Editar' : 'Abrir') +
                  ' rascunho: ' +
                  (draft.subject || '(Sem assunto)')
                }
                disabled={draft.source === 'draft' && !draft.can_edit}
                onClick={() =>
                  draft.source === 'draft'
                    ? onOpenDraft(draft.id)
                    : draft.thread_id && onOpenMessage(draft.thread_id, draft.id)
                }
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold" title={draft.subject}>
                    {draft.subject || '(Sem assunto)'}
                  </span>
                  <time
                    dateTime={draft.updated_at}
                    className="shrink-0 text-xs text-muted-foreground"
                    title={new Date(draft.updated_at).toLocaleString('pt-BR', {
                      timeZone: me.data?.preferences.timezone,
                    })}
                  >
                    {new Date(draft.updated_at).toLocaleDateString('pt-BR', {
                      timeZone: me.data?.preferences.timezone,
                    })}
                  </time>
                </div>
                <p
                  className="truncate text-xs"
                  title={draft.to_addresses.map((a) => a.address).join(', ')}
                >
                  Para:{' '}
                  {draft.to_addresses.map((a) => a.name || a.address).join(', ') ||
                    'Sem destinatário'}
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {draft.has_attachments && (
                    <Paperclip className="size-3.5 shrink-0" aria-label="Contém anexos" />
                  )}
                  <span className="truncate">{draft.snippet || 'Sem conteúdo'}</span>
                </div>
              </button>
              {draft.source === 'draft' && draft.can_edit && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="mr-2 mt-2 size-11 shrink-0 text-destructive sm:size-8"
                  aria-label={'Excluir rascunho: ' + (draft.subject || '(Sem assunto)')}
                  onClick={() => setRemoving(draft)}
                >
                  <Trash2 />
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      {pagination}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
        title="Excluir rascunho?"
        description="O conteúdo e os anexos deste rascunho serão excluídos."
        destructive
        onConfirm={async () => {
          if (!removing) return;
          await api('/outbox/' + removing.id, { method: 'DELETE' });
          setRemoving(null);
          await client.invalidateQueries({ queryKey: ['outbox', tenant] });
          toast.success('Rascunho excluído.');
        }}
      />
    </section>
  );
}
