import { labelColor, colorText } from '@/lib/label-colors';
import type { PersonalLabel } from '@/lib/organization';
export function LabelBadge({ label }: { label: PersonalLabel }) {
  return (
    <span
      className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-sm border border-input px-2 text-xs font-medium"
      style={{ backgroundColor: labelColor(label.color), color: colorText(label.color) }}
    >
      <span className="truncate" title={label.name}>
        {label.name}
      </span>
      <span className="shrink-0 text-xs">· {label.scope === 'tenant' ? 'Global' : 'Pessoal'}</span>
    </span>
  );
}
