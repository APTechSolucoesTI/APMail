import { cn } from '@/lib/utils';
import type { PersonalLabel } from '@/lib/organization';
const colors = {
  teal: 'bg-label-teal-bg text-label-teal-fg',
  blue: 'bg-info-bg text-info-fg',
  indigo: 'bg-progress-bg text-progress-fg',
  green: 'bg-success-bg text-success-fg',
  amber: 'bg-warning-bg text-warning-fg',
  red: 'bg-danger-bg text-danger-fg',
  slate: 'bg-neutral-bg text-neutral-fg',
  cyan: 'bg-label-cyan-bg text-label-cyan-fg',
};
export function LabelBadge({ label }: { label: PersonalLabel }) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-sm border px-2 text-xs font-medium',
        colors[label.color],
      )}
    >
      <span className="truncate" title={label.name}>
        {label.name}
      </span>
    </span>
  );
}
