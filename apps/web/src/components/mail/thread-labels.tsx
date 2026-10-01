import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tags } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import type { PersonalLabel } from '@/lib/organization';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { LabelBadge } from './label-badge';
export function ThreadLabels({
  threadIds,
  labels = [],
  mailboxId,
  onDone,
}: {
  threadIds: string[];
  labels?: PersonalLabel[];
  mailboxId: string;
  onDone?: () => void;
}) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    q = useQuery({ queryKey: ['labels', tenant], queryFn: () => api<PersonalLabel[]>('/labels') });
  const [open, setOpen] = useState(false),
    [selection, setSelection] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        if (v) {
          setSelection(labels.map((l) => l.id));
          setError('');
        }
        setOpen(v);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Tags />
          Etiquetas
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-96 space-y-3 overflow-y-auto" align="start">
        <p className="text-sm font-semibold">Suas etiquetas</p>
        {q.isLoading ? (
          <LoadingState />
        ) : q.error ? (
          <ErrorState onRetry={() => void q.refetch()} />
        ) : !q.data?.length ? (
          <p className="text-sm text-muted-foreground">
            Crie sua primeira etiqueta nas configurações.
          </p>
        ) : (
          q.data.map((l) => (
            <label key={l.id} className="flex min-h-11 items-center gap-2">
              <Checkbox
                checked={selection.includes(l.id)}
                onCheckedChange={(v) =>
                  setSelection((ids) =>
                    v === true ? [...ids, l.id] : ids.filter((id) => id !== l.id),
                  )
                }
              />
              <LabelBadge label={l} />
            </label>
          ))
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          A seleção substituirá as etiquetas em {threadIds.length} conversa(s).
        </p>
        <div className="flex gap-2">
          <Button
            disabled={busy || q.isLoading || !!q.error}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                await api('/mailboxes/' + mailboxId + '/threads/bulk', {
                  method: 'POST',
                  body: { thread_ids: threadIds, action: 'labels', label_ids: selection },
                });
                await Promise.all(
                  ['labels', 'threads', 'thread'].map((key) =>
                    client.invalidateQueries({ queryKey: [key] }),
                  ),
                );
                setOpen(false);
                toast.success('Etiquetas atualizadas.');
                onDone?.();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? 'Aplicando…' : 'Aplicar'}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
