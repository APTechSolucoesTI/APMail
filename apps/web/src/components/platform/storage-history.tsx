import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { LineChart, Line, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { StorageHistoryPoint, ListQuery } from '@apmail/shared';
import { api } from '@/lib/api';
import { formatStorageBytes, storageQuality } from '@/lib/storage-metering';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { ConfigurableTable } from '@/components/data/configurable-table';

export function StorageHistory({
  tenantId,
  mailboxId,
  period = '30d',
}: {
  tenantId?: string;
  mailboxId?: string;
  period?: string;
}) {
  const [listQuery, setListQuery] = useState<ListQuery>({ page: 1, pageSize: 10, filters: {} });
  const query = useQuery({
    queryKey: ['platform', 'storage-history', tenantId, mailboxId, period],
    queryFn: ({ signal }) =>
      api<StorageHistoryPoint[]>(
        '/superadmin/metering/history?' +
          new URLSearchParams({
            period,
            ...(tenantId ? { tenant_id: tenantId } : {}),
            ...(mailboxId ? { mailbox_id: mailboxId } : {}),
          }),
        { signal },
      ),
    refetchInterval: 60000,
  });
  const points = query.data ?? [];
  const chart = points.map((p) => ({
    ...p,
    date: new Date(p.measured_at).toLocaleString('pt-BR'),
    total: Number((BigInt(p.attributed_bytes) * 1000n) / 1048576n) / 1000,
    files: Number((BigInt(p.file_bytes) * 1000n) / 1048576n) / 1000,
  }));
  return (
    <section
      className="space-y-3 rounded-lg border bg-card p-4"
      aria-label="Histórico de armazenamento"
    >
      <h2 className="text-xl font-semibold">Evolução do armazenamento</h2>
      <p className="text-sm text-muted-foreground">
        Medições observadas, consolidadas por hora e por dia conforme a retenção configurada.
        Lacunas não representam consumo zero. Medições parciais e pendentes são identificadas nos
        valores exatos.
      </p>
      {query.isLoading ? (
        <LoadingState />
      ) : query.error ? (
        <ErrorState onRetry={() => void query.refetch()} />
      ) : points.length < 2 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Histórico insuficiente. O gráfico aparecerá após duas medições em horários diferentes.
        </p>
      ) : (
        <ChartContainer
          config={{
            total: { label: 'Dados atribuídos (MiB)', color: 'var(--chart-1)' },
            files: { label: 'Arquivos (MiB)', color: 'var(--chart-2)' },
          }}
          className="h-64 w-full aspect-auto"
        >
          <LineChart accessibilityLayer data={chart} margin={{ left: 8, right: 16, top: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" minTickGap={50} />
            <YAxis width={70} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Line
              dataKey="total"
              stroke="var(--color-total)"
              dot={false}
              isAnimationActive={false}
            />
            <Line
              dataKey="files"
              stroke="var(--color-files)"
              strokeDasharray="5 3"
              dot={false}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      )}
      {points.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm text-primary">
            Consultar valores exatos das medições
          </summary>
          <div className="mt-3">
            <ConfigurableTable
              listKey="platform-storage-history-values"
              mode="client"
              query={listQuery}
              onQueryChange={setListQuery}
              data={points.map((point) => ({ ...point, id: point.measured_at }))}
              columns={[
                {
                  id: 'measured_at',
                  header: 'Data e hora',
                  hideable: false,
                  cell: (point) => new Date(point.measured_at).toLocaleString('pt-BR'),
                },
                ...(['attributed_bytes', 'file_bytes', 'logical_bytes'] as const).map(
                  (key, index) => ({
                    id: key,
                    header: ['Dados atribuídos (B)', 'Arquivos (B)', 'Dados lógicos (B)'][index]!,
                    align: 'right' as const,
                    cell: (point: StorageHistoryPoint) => (
                      <span title={formatStorageBytes(point[key])}>
                        {BigInt(point[key]).toLocaleString('pt-BR')}
                      </span>
                    ),
                  }),
                ),
                {
                  id: 'quality',
                  header: 'Qualidade',
                  cell: (point) =>
                    point.quality ? storageQuality[point.quality] : 'Não informada',
                },
              ]}
            />
          </div>
        </details>
      )}
    </section>
  );
}
