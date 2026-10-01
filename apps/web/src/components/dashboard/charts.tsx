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
  type DailyVolume,
  type FolderVolume,
  type DashboardQueue,
} from '@apmail/shared';
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
        <div className="max-h-64 overflow-auto">
          <table className="w-full">
            <caption className="sr-only">Volume diário</caption>
            <thead>
              <tr>
                <th scope="col" className="text-left">
                  Dia
                </th>
                <th scope="col" className="text-right">
                  Recebidos
                </th>
                <th scope="col" className="text-right">
                  Enviados
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((row) => (
                <tr key={row.day} className="border-t">
                  <td className="py-1">{dayLabel(row.day)}</td>
                  <td className="text-right tabular-nums">{row.received}</td>
                  <td className="text-right tabular-nums">{row.sent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
export function FolderChart({ data }: { data: FolderVolume[] }) {
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
      <ol className="mt-2 space-y-2 text-xs">
        {rows.map((row) => (
          <li key={row.key} className="flex gap-2">
            <span className="font-mono text-muted-foreground">{row.key}.</span>
            <span className="min-w-0 flex-1 break-words">
              {row.mailbox_name} · {row.folder_name}
            </span>
            <span className="shrink-0 tabular-nums">{row.received}</span>
          </li>
        ))}
      </ol>
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
