import { useQuery } from '@tanstack/react-query';
import { LineChart, Line, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { StorageHistoryPoint } from '@apmail/shared';
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

export function StorageHistory({
  tenantId,
  mailboxId,
  period = '30d',
}: {
  tenantId?: string;
  mailboxId?: string;
  period?: string;
}) {
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
          <div className="mt-3 max-h-64 overflow-auto rounded-md border">
            <table className="w-full text-xs">
              <caption className="sr-only">Histórico em bytes, sem arredondamento</caption>
              <thead className="sticky top-0 bg-card">
                <tr>
                  <th className="p-2 text-left">Data e hora</th>
                  <th className="p-2 text-right">Dados atribuídos</th>
                  <th className="p-2 text-right">Arquivos</th>
                  <th className="p-2 text-right">Dados lógicos</th>
                  <th className="p-2 text-left">Qualidade</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.measured_at} className="border-t">
                    <td className="whitespace-nowrap p-2">
                      {new Date(p.measured_at).toLocaleString('pt-BR')}
                    </td>
                    {(['attributed_bytes', 'file_bytes', 'logical_bytes'] as const).map((k) => (
                      <td
                        key={k}
                        className="p-2 text-right tabular-nums"
                        title={formatStorageBytes(p[k])}
                      >
                        {BigInt(p[k]).toLocaleString('pt-BR')} B
                      </td>
                    ))}
                    <td className="p-2">
                      {p.quality ? storageQuality[p.quality] : 'Não informada'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
