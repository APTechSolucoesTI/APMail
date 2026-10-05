import { BarChart, Bar, CartesianGrid, XAxis, YAxis } from 'recharts';
import type { MeteredRow } from '@apmail/shared';
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart';
import { categoryLabels } from '@/lib/storage-metering';

export function StorageComposition({ categories }: { categories: MeteredRow['categories'] }) {
  const points = categories
    .filter((v) => BigInt(v.logical_bytes) + BigInt(v.file_bytes) > 0n)
    .map((v) => ({
      name: categoryLabels[v.category] ?? v.category,
      logical: Number((BigInt(v.logical_bytes) * 1000n) / 1048576n) / 1000,
      files: Number((BigInt(v.file_bytes) * 1000n) / 1048576n) / 1000,
    }));
  return (
    <section className="space-y-3" aria-label="Composição do armazenamento">
      <h3 className="text-lg font-semibold">Composição por categoria</h3>
      <p className="text-sm text-muted-foreground">
        Dados lógicos e arquivos presentes em MiB. Os valores exatos estão nos detalhes abaixo.
      </p>
      {points.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          Nenhum consumo observado.
        </p>
      ) : (
        <ChartContainer
          config={{
            logical: { label: 'Dados lógicos (MiB)', color: 'var(--chart-1)' },
            files: { label: 'Arquivos (MiB)', color: 'var(--chart-2)' },
          }}
          className="h-80 w-full aspect-auto"
        >
          <BarChart
            accessibilityLayer
            data={points}
            layout="vertical"
            margin={{ right: 16, left: 8 }}
          >
            <CartesianGrid horizontal={false} />
            <YAxis dataKey="name" type="category" width={115} tick={{ fontSize: 12 }} />
            <XAxis type="number" />
            <ChartTooltip content={<ChartTooltipContent />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="logical"
              stackId="bytes"
              fill="var(--color-logical)"
              isAnimationActive={false}
            />
            <Bar
              dataKey="files"
              stackId="bytes"
              fill="var(--color-files)"
              isAnimationActive={false}
            />
          </BarChart>
        </ChartContainer>
      )}
    </section>
  );
}
