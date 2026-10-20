import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Download, Eye, RefreshCw } from 'lucide-react';
import { listQuerySchema, calendarInstant } from '@apmail/shared';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { meQuery, useTenantId } from '@/lib/auth';
import { tableParameters } from '@/lib/table-query';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
import { StatusBadge } from '@/components/common/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuditDetail } from './audit-detail';
import {
  actionLabel,
  auditOutcome,
  auditSummary,
  humanValue,
  record,
  type AuditEntry,
} from './audit-format';

export const auditSearchSchema = listQuerySchema.extend({
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  mailbox_id: z.uuid().optional(),
});
type AuditQuery = z.infer<typeof auditSearchSchema>;
type Options = {
  actors: { actor_id: string | null; name: string; email: string }[];
  actions: string[];
  mailboxes: { mailbox_id: string; name: string }[];
  can_read_content: boolean;
};
export function AuditExplorer({ query }: { query: AuditQuery }) {
  const tenant = useTenantId(),
    me = useQuery(meQuery),
    navigate = useNavigate();
  const timezone = me.data?.preferences.timezone ?? 'America/Sao_Paulo';
  const [detail, setDetail] = useState<string | null>(null),
    [exporting, setExporting] = useState(false);
  const options = useQuery({
    queryKey: ['audit-options', tenant],
    queryFn: () => api<Options>('/audit-logs/options'),
  });
  const parameters = new URLSearchParams({
    ...tableParameters(query),
    page: String(query.page),
    pageSize: String(query.pageSize),
    ...(query.search ? { search: query.search } : {}),
    ...(query.filters.actor?.length ? { actor_ids: query.filters.actor.join(',') } : {}),
    ...(query.filters.action?.length ? { actions: query.filters.action.join(',') } : {}),
    ...(query.mailbox_id ? { mailbox_id: query.mailbox_id } : {}),
    ...(query.from ? { from: calendarInstant(query.from + 'T00:00:00.000', timezone) } : {}),
    ...(query.to ? { to: calendarInstant(query.to + 'T23:59:59.999', timezone) } : {}),
  });
  const q = useQuery({
    queryKey: ['audit', tenant, parameters.toString()],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api<{ items: AuditEntry[]; total: number }>('/audit-logs?' + parameters, { signal }),
  });
  const change = (patch: Partial<AuditQuery>) =>
    void navigate({ to: '/settings/audit', search: { ...query, ...patch, page: 1 } });
  const date = (value: string) => new Date(value).toLocaleString('pt-BR', { timeZone: timezone });
  async function exportCsv() {
    setExporting(true);
    try {
      const response = await fetch('/api/audit-logs/export.csv?' + parameters, {
        credentials: 'same-origin',
      });
      if (!response.ok) {
        const value = (await response.json()) as { error?: { message?: string } };
        throw new Error(value.error?.message ?? 'Não foi possível exportar.');
      }
      const url = URL.createObjectURL(await response.blob()),
        anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'apmail-auditoria.csv';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success('Auditoria exportada. O arquivo não inclui o corpo dos e-mails.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Não foi possível exportar.');
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Entenda quem fez cada ação, quando aconteceu e quais registros foram afetados."
        actions={
          <>
            <Button
              variant="outline"
              disabled={q.isFetching}
              onClick={() => {
                void q.refetch();
                void options.refetch();
              }}
            >
              <RefreshCw className={'size-4 ' + (q.isFetching ? 'animate-spin' : '')} />
              Atualizar
            </Button>
            <Button
              variant="outline"
              disabled={exporting || !q.data?.total}
              onClick={() => void exportCsv()}
            >
              <Download className="size-4" />
              {exporting ? 'Exportando…' : 'Exportar CSV'}
            </Button>
          </>
        }
      />
      <div className="mb-4 flex flex-col gap-2 rounded-lg border bg-card px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p>
          <span className="font-semibold">Histórico da empresa</span>
          <span className="ml-2 text-muted-foreground">
            Ações manuais, automações e resultados de processamento.
          </span>
        </p>
        <span className="shrink-0 text-xs text-muted-foreground">Horários em {timezone}</span>
      </div>
      <ConfigurableTable<AuditEntry>
        listKey="audit-explorer-v2"
        mode="server"
        data={q.data?.items ?? []}
        total={q.data?.total ?? 0}
        query={query}
        onQueryChange={(value) =>
          void navigate({ to: '/settings/audit', search: { ...query, ...value } })
        }
        isLoading={q.isLoading}
        isFetching={q.isFetching}
        error={q.error}
        onRetry={() => void q.refetch()}
        searchPlaceholder="Buscar pessoa, assunto, destinatário ou ação…"
        columns={[
          {
            id: 'action',
            header: 'Ação',
            hideable: false,
            cell: (e) => {
              const status = auditOutcome(e);
              return (
                <div className="max-w-52 space-y-1">
                  <span className="block font-medium">{actionLabel(e.action)}</span>
                  <StatusBadge label={status.label} variant={status.variant} />
                </div>
              );
            },
          },
          {
            id: 'actor_name',
            header: 'Quem fez',
            cell: (e) => (
              <div className="max-w-48">
                <span className="block">{e.actor_name ?? 'Sistema / automação'}</span>
                {e.actor_email && (
                  <span
                    title={e.actor_email}
                    className="mt-0.5 block truncate text-xs text-muted-foreground"
                  >
                    {e.actor_email}
                  </span>
                )}
              </div>
            ),
          },
          {
            id: 'message_subject',
            header: 'Mensagem ou registro',
            cell: (e) => {
              const mail = record(e.metadata.message);
              return (
                <div className="max-w-64">
                  <span className="block truncate" title={auditSummary(e)}>
                    {auditSummary(e)}
                  </span>
                  {Array.isArray(mail.to) && mail.to.length > 0 && (
                    <span
                      className="mt-0.5 block truncate text-xs text-muted-foreground"
                      title={humanValue(mail.to)}
                    >
                      Para: {humanValue(mail.to)}
                    </span>
                  )}
                </div>
              );
            },
          },
          {
            id: 'mailbox',
            header: 'Caixa',
            sortable: false,
            cell: (e) => String(record(e.metadata.mailbox).name ?? '—'),
          },
          {
            id: 'created_at',
            header: 'Quando',
            cell: (e) => <span className="whitespace-nowrap">{date(e.created_at)}</span>,
          },
        ]}
        toolbarLeft={
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="audit-from">De</Label>
              <Input
                id="audit-from"
                type="date"
                value={query.from ?? ''}
                max={query.to}
                className="h-11 w-36 sm:h-8"
                onChange={(e) => change({ from: e.target.value || undefined })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="audit-to">Até</Label>
              <Input
                id="audit-to"
                type="date"
                value={query.to ?? ''}
                min={query.from}
                className="h-11 w-36 sm:h-8"
                onChange={(e) => change({ to: e.target.value || undefined })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="audit-mailbox">Caixa de e-mail</Label>
              <select
                id="audit-mailbox"
                className="h-11 max-w-56 rounded-md border border-input bg-background px-2 text-sm sm:h-8"
                value={query.mailbox_id ?? ''}
                onChange={(e) => change({ mailbox_id: e.target.value || undefined })}
              >
                <option value="">Todas as caixas</option>
                {Array.from(
                  new Map((options.data?.mailboxes ?? []).map((b) => [b.mailbox_id, b])).values(),
                ).map((b) => (
                  <option key={b.mailbox_id} value={b.mailbox_id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            {(query.from || query.to || query.mailbox_id) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => change({ from: undefined, to: undefined, mailbox_id: undefined })}
              >
                Limpar período e caixa
              </Button>
            )}
          </div>
        }
        filters={[
          {
            id: 'actor',
            label: 'Usuário',
            options: Array.from(
              new Map(
                (options.data?.actors ?? []).filter((a) => a.actor_id).map((a) => [a.actor_id!, a]),
              ).values(),
            ).map((a) => ({ value: a.actor_id!, label: a.name })),
          },
          {
            id: 'action',
            label: 'Tipo de ação',
            options: (options.data?.actions ?? []).map((a) => ({
              value: a,
              label: actionLabel(a),
            })),
          },
        ]}
        rowActions={(e) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={'Visualizar ' + actionLabel(e.action)}
            onClick={() => setDetail(e.id)}
          >
            <Eye className="size-4" />
          </Button>
        )}
      />
      <p className="mt-3 text-xs text-muted-foreground">
        “Solicitado” registra a intenção; a conclusão ou falha aparece em um evento separado.
        Registros anteriores à ampliação da auditoria exibem somente os dados que já estavam
        disponíveis.
      </p>
      <AuditDetail id={detail} onClose={() => setDetail(null)} date={date} />
    </>
  );
}
