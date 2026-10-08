import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from 'recharts';
import {
  QUEUE_LABELS,
  type ListQuery,
  type DailyVolume,
  type FolderVolume,
  type DashboardQueue,
} from '@apmail/shared';
import { useState } from 'react';
import { ConfigurableTable } from '@/components/data/configurable-table';
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from '@/components/ui/chart';
const volumeConfig = {
  received: { label: 'Recebidos', color: 'var(--chart-1)' },
  sent: { label: 'Enviados', color: 'var(--chart-2)' },
};
const dayLabel = (day: string) => day.slice(8, 10) + '/' + day.slice(5, 7);
export function VolumeChart({ data }: { data: DailyVolume[] }) {
  const [query, setQuery] = useState<ListQuery>({ page: 1, pageSize: 10, filters: {} });
  return (
    <>
      <ChartContainer config={volumeConfig} className="h-64 w-full aspect-auto">
        <LineChart accessibilityLayer data={data} margin={{ top: 8, left: -16, right: 12 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} tickMargin={8} minTickGap={24} />
          <YAxis allowDecimals={false} />
          <ChartTooltip
            content={<ChartTooltipContent labelFormatter={(label) => dayLabel(String(label))} />}
          />
          <ChartLegend content={<ChartLegendContent />} />
          <Line
            dataKey="received"
            stroke="var(--color-received)"
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="sent"
            stroke="var(--color-sent)"
            strokeWidth={2}
            strokeDasharray="6 3"
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
      <details className="mt-3 text-xs">
        <summary className="cursor-pointer rounded-sm py-2 focus-visible:ring-2 focus-visible:ring-ring">
          Ver valores por dia
        </summary>
        <ConfigurableTable
          listKey="dashboard-volume-days"
          mode="client"
          query={query}
          onQueryChange={setQuery}
          data={data.map((value) => ({ ...value, id: value.day }))}
          columns={[
            { id: 'day', header: 'Dia', hideable: false, cell: (value) => dayLabel(value.day) },
            { id: 'received', header: 'Recebidos', align: 'right' },
            { id: 'sent', header: 'Enviados', align: 'right' },
          ]}
        />
      </details>
    </>
  );
}
export function FolderChart({ data }: { data: FolderVolume[] }) {
  const [query, setQuery] = useState<ListQuery>({ page: 1, pageSize: 10, filters: {} });
  const rows = data.slice(0, 10).map((row, index) => ({ ...row, key: String(index + 1) }));
  return (
    <>
      <ChartContainer config={volumeConfig} className="h-72 w-full aspect-auto">
        <BarChart
          accessibilityLayer
          layout="vertical"
          data={rows}
          margin={{ right: 32, left: -12 }}
        >
          <CartesianGrid horizontal={false} />
          <XAxis type="number" allowDecimals={false} />
          <YAxis type="category" dataKey="key" width={32} />
          <ChartTooltip
            content={
              <ChartTooltipContent
                labelFormatter={(label) => {
                  const row = rows.find((r) => r.key === String(label));
                  return row ? row.mailbox_name + ' · ' + row.folder_name : String(label);
                }}
              />
            }
          />
          <Bar dataKey="received" fill="var(--color-received)" radius={4} isAnimationActive={false}>
            <LabelList dataKey="received" position="right" className="fill-foreground" />
          </Bar>
        </BarChart>
      </ChartContainer>
      <ConfigurableTable
        listKey="dashboard-folder-volume-values"
        mode="client"
        query={query}
        onQueryChange={setQuery}
        data={rows.map((row) => ({ ...row, id: row.key }))}
        columns={[
          { id: 'mailbox_name', header: 'Caixa', hideable: false },
          { id: 'folder_name', header: 'Pasta' },
          { id: 'received', header: 'Recebidos', align: 'right' },
        ]}
      />
    </>
  );
}
const queueColors = {
  to_reply: 'var(--info)',
  in_progress: 'var(--progress)',
  awaiting_reply: 'var(--warning)',
  scheduled: 'var(--neutral)',
  done: 'var(--success)',
};
const queueBorders = {
  to_reply: 'var(--info-fg)',
  in_progress: 'var(--progress-fg)',
  awaiting_reply: 'var(--warning-fg)',
  scheduled: 'var(--neutral-fg)',
  done: 'var(--success-fg)',
};
export function QueueChart({ data }: { data: DashboardQueue[] }) {
  const rows = data.map((row) => ({ ...row, label: QUEUE_LABELS[row.status] }));
  return (
    <ChartContainer
      config={{ count: { label: 'Conversas', color: 'var(--chart-1)' } }}
      className="h-72 w-full aspect-auto"
    >
      <BarChart accessibilityLayer layout="vertical" data={rows} margin={{ right: 32, left: -8 }}>
        <CartesianGrid horizontal={false} />
        <XAxis type="number" allowDecimals={false} />
        <YAxis type="category" dataKey="label" width={116} tick={{ fontSize: 12 }} />
        <ChartTooltip content={<ChartTooltipContent />} />
        <Bar dataKey="count" radius={4} isAnimationActive={false}>
          {rows.map((row) => (
            <Cell
              key={row.status}
              fill={queueColors[row.status]}
              stroke={queueBorders[row.status]}
              strokeWidth={1.5}
            />
          ))}
          <LabelList dataKey="count" position="right" className="fill-foreground" />
        </Bar>
      </BarChart>
    </ChartContainer>
  );
}
