import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Tags } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId, meQuery } from '@/lib/auth';
import type { PersonalLabel } from '@/lib/organization';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingState, ErrorState } from '@/components/data/data-state';
import { LabelBadge } from './label-badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
export function ThreadLabels({
  threadIds,
  labels = [],
  mailboxId,
  onDone,
  presentation = 'popover',
  onClose,
}: {
  threadIds: string[];
  labels?: PersonalLabel[];
  mailboxId: string;
  onDone?: () => void;
  presentation?: 'popover' | 'dialog';
  onClose?: () => void;
}) {
  const tenant = useTenantId(),
    client = useQueryClient(),
    me = useQuery(meQuery).data,
    q = useQuery({
      queryKey: ['labels', tenant, me?.user.id, mailboxId],
      queryFn: () => api<PersonalLabel[]>('/labels?mailbox_id=' + mailboxId),
    });
  const [open, setOpen] = useState(presentation === 'dialog'),
    [selection, setSelection] = useState<string[]>(() => labels.map((label) => label.id)),
    [globalChanges, setGlobalChanges] = useState<Record<string, boolean>>({}),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const changeOpen = (value: boolean) => {
    if (value) {
      setSelection(labels.map((label) => label.id));
      setError('');
      setGlobalChanges({});
    }
    setOpen(value);
    if (!value) onClose?.();
  };
  const content = (
    <>
      <p className="text-sm font-semibold">Etiquetas pessoais e globais</p>
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
              onCheckedChange={(v) => {
                setSelection((ids) =>
                  v === true ? [...ids, l.id] : ids.filter((id) => id !== l.id),
                );
                if (l.scope === 'tenant')
                  setGlobalChanges((changes) => ({ ...changes, [l.id]: v === true }));
              }}
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
        Pessoais: substituir a seleção em {threadIds.length} conversa(s). Globais: alterar somente
        as opções que você marcou ou desmarcou.
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
                body: {
                  thread_ids: threadIds,
                  action: 'labels',
                  label_ids: selection.filter(
                    (id) => q.data?.find((l) => l.id === id)?.scope !== 'tenant',
                  ),
                  global_add: Object.keys(globalChanges).filter((id) => globalChanges[id]),
                  global_remove: Object.keys(globalChanges).filter((id) => !globalChanges[id]),
                },
              });
              await Promise.all(
                ['labels', 'threads', 'thread'].map((key) =>
                  client.invalidateQueries({ queryKey: [key] }),
                ),
              );
              changeOpen(false);
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
        <Button variant="ghost" disabled={busy} onClick={() => changeOpen(false)}>
          Cancelar
        </Button>
      </div>
    </>
  );
  if (presentation === 'dialog')
    return (
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!busy) changeOpen(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto" showCloseButton={!busy}>
          <DialogHeader>
            <DialogTitle>Etiquetas da conversa</DialogTitle>
            <DialogDescription>Selecione as etiquetas e aplique as alterações.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">{content}</div>
        </DialogContent>
      </Dialog>
    );
  return (
    <Popover
      open={open}
      onOpenChange={(value) => {
        if (!busy) changeOpen(value);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          <Tags />
          Etiquetas
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-h-96 space-y-3 overflow-y-auto" align="start">
        {content}
      </PopoverContent>
    </Popover>
  );
}
