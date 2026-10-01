import { cva } from 'class-variance-authority';
import {
  AlarmClock,
  CheckCircle2,
  CircleAlert,
  CircleCheck,
  CircleSlash,
  Clock,
  Hourglass,
  Inbox,
  Loader2,
  UserCheck,
  type LucideIcon,
} from 'lucide-react';
import {
  QUEUE_LABELS,
  MAILBOX_LABELS,
  OUTBOX_LABELS,
  ROLE_LABELS,
  type QueueStatus,
} from '@apmail/shared';
import { cn } from '@/lib/utils';
export type StatusVariant = 'info' | 'progress' | 'warning' | 'success' | 'danger' | 'neutral';
const variants = cva(
  'inline-flex h-5 items-center gap-1 whitespace-nowrap rounded-sm border px-2 text-[11px] font-medium',
  {
    variants: {
      variant: {
        info: 'border-info/30 bg-info-bg text-info-fg',
        progress: 'border-progress/30 bg-progress-bg text-progress-fg',
        warning: 'border-warning/30 bg-warning-bg text-warning-fg',
        success: 'border-success/30 bg-success-bg text-success-fg',
        danger: 'border-danger/30 bg-danger-bg text-danger-fg',
        neutral: 'border-neutral/30 bg-neutral-bg text-neutral-fg',
      },
    },
  },
);
export function StatusBadge({
  label,
  icon: Icon,
  variant = 'neutral',
}: {
  label: string;
  icon?: LucideIcon;
  variant?: StatusVariant;
}) {
  return (
    <span className={cn(variants({ variant }))}>
      {Icon && <Icon className="size-3" aria-hidden="true" />}
      {label}
    </span>
  );
}
const queueStyles: Record<Exclude<QueueStatus, 'none'>, [StatusVariant, LucideIcon]> = {
  to_reply: ['info', Inbox],
  in_progress: ['progress', UserCheck],
  awaiting_reply: ['warning', Hourglass],
  scheduled: ['neutral', Clock],
  done: ['success', CheckCircle2],
};
export function QueueStatusBadge({ status }: { status: QueueStatus }) {
  if (status === 'none') return null;
  const [variant, icon] = queueStyles[status];
  return <StatusBadge label={QUEUE_LABELS[status]} variant={variant} icon={icon} />;
}
export function OverdueBadge() {
  return <StatusBadge label="Fora do SLA" icon={AlarmClock} variant="danger" />;
}
export function MailboxStatusBadge({ status }: { status: keyof typeof MAILBOX_LABELS }) {
  const icons = {
    active: CircleCheck,
    pending: Loader2,
    error: CircleAlert,
    disabled: CircleSlash,
  };
  const styles: Record<typeof status, StatusVariant> = {
    active: 'success',
    pending: 'info',
    error: 'danger',
    disabled: 'neutral',
  };
  return (
    <StatusBadge label={MAILBOX_LABELS[status]} icon={icons[status]} variant={styles[status]} />
  );
}
export function OutboxStatusBadge({ status }: { status: keyof typeof OUTBOX_LABELS }) {
  const variant: StatusVariant =
    status === 'sent'
      ? 'success'
      : status === 'failed'
        ? 'danger'
        : ['queued', 'sending'].includes(status)
          ? 'info'
          : 'neutral';
  return (
    <StatusBadge
      label={OUTBOX_LABELS[status]}
      variant={variant}
      icon={status === 'scheduled' ? Clock : undefined}
    />
  );
}
export function RoleBadge({ role }: { role: keyof typeof ROLE_LABELS }) {
  return <StatusBadge label={ROLE_LABELS[role]} />;
}
