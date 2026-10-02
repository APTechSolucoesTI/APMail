import { useState } from 'react';
import { useTenantId, meQuery } from '@/lib/auth';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { z } from 'zod';
import { Eye } from 'lucide-react';
import { listQuerySchema, AUDIT_ACTION_LABELS } from '@apmail/shared';
import { PageHeader } from '@/components/layout/page-header';
import { ConfigurableTable } from '@/components/data/configurable-table';
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
import { api } from '@/lib/api';
import { requireSettingsCapability } from '@/lib/settings';
type Entry = {
  id: string;
  action: string;
  actor_name: string | null;
  entity_type: string;
  entity_id: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
};
const entities: Record<string, string> = {
  user: 'Usuário',
  tenant: 'Empresa',
  mailbox: 'Caixa',
  folder: 'Pasta',
  rule: 'Regra',
  message: 'Mensagem',
  outbox: 'Envio',
  thread: 'Conversa',
};
export const Route = createFileRoute('/_app/settings/audit')({
  beforeLoad: () => requireSettingsCapability('audit'),
  validateSearch: listQuerySchema.extend({
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  }),
  component: Audit,
});
function Audit() {
  const query = Route.useSearch(),
    navigate = useNavigate(),
    tenant = useTenantId(),
    me = useQuery(meQuery),
    [detail, setDetail] = useState<Entry | null>(null),
    users = useQuery({
      queryKey: ['members', tenant],
      queryFn: () => api<{ members: { user_id: string; full_name: string }[] }>('/members'),
    });
  const q = useQuery({
    queryKey: ['audit', tenant, query],
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) =>
      api<{ items: Entry[]; total: number }>(
        '/audit-logs?' +
          new URLSearchParams({
            page: String(query.page),
            pageSize: String(query.pageSize),
            ...(query.search ? { search: query.search } : {}),
            ...(query.filters.actor?.length ? { actor_ids: query.filters.actor.join(',') } : {}),
            ...(query.filters.action?.length ? { actions: query.filters.action.join(',') } : {}),
            ...(query.from ? { from: query.from + 'T00:00:00.000Z' } : {}),
            ...(query.to ? { to: query.to + 'T23:59:59.999Z' } : {}),
          }),
        { signal },
      ),
  });
  const date = (value: string) =>
    new Date(value).toLocaleString('pt-BR', { timeZone: me.data?.preferences.timezone });
  const change = (patch: Partial<typeof query>) =>
    void navigate({ to: '/settings/audit', search: { ...query, ...patch, page: 1 } });
  return (
    <>
      <PageHeader title="Auditoria" description="Acompanhe alterações e acessos da equipe." />
      <ConfigurableTable
        listKey="audit-logs"
        mode="server"
        columns={[
          {
            id: 'action',
            header: 'Ação',
            hideable: false,
            cell: (e) => AUDIT_ACTION_LABELS[e.action] ?? 'Alteração registrada',
          },
          { id: 'actor_name', header: 'Usuário', cell: (e) => e.actor_name ?? 'Sistema' },
          {
            id: 'entity_type',
            header: 'Registro',
            cell: (e) => entities[e.entity_type] ?? 'Registro',
          },
          { id: 'created_at', header: 'Data', cell: (e) => date(e.created_at) },
        ]}
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
        toolbarLeft={
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1">
              <Label htmlFor="audit-from">De (UTC)</Label>
              <Input
                id="audit-from"
                type="date"
                className="h-11 w-40 sm:h-8"
                value={query.from ?? ''}
                max={query.to}
                onChange={(e) => change({ from: e.target.value || undefined })}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="audit-to">Até (UTC)</Label>
              <Input
                id="audit-to"
                type="date"
                className="h-11 w-40 sm:h-8"
                value={query.to ?? ''}
                min={query.from}
                onChange={(e) => change({ to: e.target.value || undefined })}
              />
            </div>
            {(query.from || query.to) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => change({ from: undefined, to: undefined })}
              >
                Limpar período
              </Button>
            )}
          </div>
        }
        filters={[
          {
            id: 'actor',
            label: 'Usuário',
            options: (users.data?.members ?? []).map((u) => ({
              value: u.user_id,
              label: u.full_name,
            })),
          },
          {
            id: 'action',
            label: 'Tipo de ação',
            options: Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({
              value,
              label,
            })),
          },
        ]}
        rowActions={(e) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={'Visualizar detalhes de ' + (AUDIT_ACTION_LABELS[e.action] ?? 'alteração')}
            onClick={() => setDetail(e)}
          >
            <Eye className="size-4" aria-hidden />
          </Button>
        )}
      />
      <Dialog
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {detail ? (AUDIT_ACTION_LABELS[detail.action] ?? 'Detalhes da alteração') : ''}
            </DialogTitle>
            <DialogDescription>
              {detail ? (detail.actor_name ?? 'Sistema') + ' · ' + date(detail.created_at) : ''}
            </DialogDescription>
          </DialogHeader>
          <dl className="space-y-2 text-sm">
            <dt className="font-semibold">Registro</dt>
            <dd>{detail ? (entities[detail.entity_type] ?? 'Registro') : ''}</dd>
            {detail?.entity_id && (
              <>
                <dt className="font-semibold">Identificador</dt>
                <dd className="break-all font-mono text-xs">{detail.entity_id}</dd>
              </>
            )}
          </dl>
          <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border bg-muted p-3 font-mono text-xs">
            {JSON.stringify(detail?.metadata ?? {}, null, 2)}
          </pre>
        </DialogContent>
      </Dialog>
    </>
  );
}
