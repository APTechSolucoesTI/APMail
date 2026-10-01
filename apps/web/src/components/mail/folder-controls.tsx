import { useState, useEffect, useContext, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Ellipsis, Plus, Pencil, Trash2, Lock } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { SocketContext, useSocketRoom } from '@/hooks/use-socket-room';
import { flattenFolders, folderLabel, type Folder } from '@/lib/mail';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { SchemaForm } from '@/components/forms/schema-form';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { LoadingState, ErrorState } from '@/components/data/data-state';
const nameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((v) => !/[\r\n\0/\\]/.test(v), 'Use um nome sem barras ou quebras de linha.'),
});
type Pending = { id: string; kind: 'create' | 'rename' | 'delete'; name: string };
export function FolderControls({
  mailboxId,
  folder,
  children,
}: {
  mailboxId: string;
  folder?: Folder;
  children?: ReactNode;
}) {
  const client = useQueryClient(),
    socket = useContext(SocketContext);
  const [menu, setMenu] = useState(false),
    [edit, setEdit] = useState<'create' | 'rename' | null>(null),
    [remove, setRemove] = useState(false),
    [pending, setPending] = useState<Pending | null>(null),
    [error, setError] = useState('');
  const enqueue = async (kind: Pending['kind'], name = '') => {
    const url =
      kind === 'create' ? '/mailboxes/' + mailboxId + '/folders' : '/folders/' + folder!.id;
    const result = await api<{ action_id: string }>(url, {
      method: kind === 'create' ? 'POST' : kind === 'rename' ? 'PATCH' : 'DELETE',
      ...(kind === 'delete'
        ? {}
        : { body: kind === 'create' ? { name, parent_id: folder?.id ?? null } : { name } }),
    });
    setPending({ id: result.action_id, kind, name });
    setEdit(null);
    setRemove(false);
    setError('');
  };
  useEffect(() => {
    if (!pending) return;
    let closed = false;
    const completed = () => {
      if (closed) return;
      closed = true;
      setPending(null);
      void client.invalidateQueries({ queryKey: ['folders'] });
      toast.success('Pasta atualizada no servidor.');
    };
    const check = async () => {
      try {
        const rows = flattenFolders(await api<Folder[]>('/mailboxes/' + mailboxId + '/folders'));
        const done =
          pending.kind === 'create'
            ? rows.some((f) => f.name === pending.name && f.parent_id === (folder?.id ?? null))
            : pending.kind === 'rename'
              ? rows.some((f) => f.id === folder?.id && f.name === pending.name)
              : !rows.some((f) => f.id === folder?.id);
        if (done) completed();
      } catch {
        /* Uma reconexão retomará a conferência. */
      }
    };
    const changed = (event: { action_id?: string; status?: string; error?: string }) => {
      if (event.action_id === pending.id) {
        if (event.status === 'failed') {
          setError(event.error ?? 'Não foi possível alterar a pasta.');
          setPending(null);
        } else completed();
      }
    };
    socket?.on('folders:changed', changed);
    const timer = setInterval(() => void check(), 5000);
    void check();
    return () => {
      closed = true;
      clearInterval(timer);
      socket?.off('folders:changed', changed);
    };
  }, [pending, folder?.id, mailboxId, socket, client]);
  return (
    <div className="min-w-0">
      <div
        className="flex min-w-0 items-center gap-1"
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(true);
        }}
        onKeyDown={(e) => {
          if (e.shiftKey && e.key === 'F10') {
            e.preventDefault();
            setMenu(true);
          }
        }}
      >
        {children && <div className="min-w-0 flex-1">{children}</div>}
        <DropdownMenu open={menu} onOpenChange={setMenu}>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size={children ? 'icon-sm' : 'sm'}
              disabled={!!pending}
              aria-label={folder ? 'Opções da pasta ' + folderLabel(folder) : 'Criar pasta'}
            >
              {children ? (
                <Ellipsis />
              ) : (
                <>
                  <Plus />
                  Criar pasta
                </>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setEdit('create')}>
              <Plus /> {folder ? 'Criar subpasta' : 'Criar pasta'}
            </DropdownMenuItem>
            {folder && (
              <>
                <DropdownMenuSeparator />
                {folder.special_use ? (
                  <DropdownMenuItem disabled>
                    <Lock />
                    Pasta especial
                  </DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem onSelect={() => setEdit('rename')}>
                      <Pencil />
                      Renomear
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onSelect={() => setRemove(true)}>
                      <Trash2 />
                      Excluir pasta
                    </DropdownMenuItem>
                  </>
                )}
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {pending && (
        <p role="status" className="px-2 text-xs text-muted-foreground">
          Aplicando no servidor…
        </p>
      )}
      {error && (
        <p role="alert" className="px-2 text-xs text-destructive">
          {error}
        </p>
      )}
      <Dialog
        open={!!edit}
        onOpenChange={(v) => {
          if (!v) setEdit(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {edit === 'rename' ? 'Renomear pasta' : folder ? 'Criar subpasta' : 'Criar pasta'}
            </DialogTitle>
            <DialogDescription>
              {folder
                ? 'Pasta atual: ' + folderLabel(folder)
                : 'A nova pasta será criada na raiz da caixa.'}
            </DialogDescription>
          </DialogHeader>
          {edit && (
            <SchemaForm
              schema={nameSchema}
              defaults={{ name: edit === 'rename' ? folder?.name : '' }}
              fields={[{ name: 'name', label: 'Nome da pasta' }]}
              cancelLabel="Cancelar"
              onSubmit={async (b) => enqueue(edit, String(b.name))}
            />
          )}
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={remove}
        onOpenChange={setRemove}
        destructive
        title="Excluir pasta?"
        description={
          'A pasta ' + (folder ? folderLabel(folder) : '') + ' precisa estar vazia e sem subpastas.'
        }
        onConfirm={() => enqueue('delete')}
      />
    </div>
  );
}
export function FolderManagement({ mailboxId }: { mailboxId: string }) {
  const tenant = useTenantId(),
    q = useQuery({
      queryKey: ['folders', tenant, mailboxId],
      queryFn: () => api<Folder[]>('/mailboxes/' + mailboxId + '/folders'),
    });
  useSocketRoom('mailbox', mailboxId);
  const tree = (folders: Folder[]): ReactNode => (
    <ul className="space-y-1">
      {folders.map((f) => (
        <li key={f.id}>
          <FolderControls mailboxId={mailboxId} folder={f}>
            <span className="flex min-h-11 min-w-0 items-center gap-2 text-sm">
              {f.special_use && <Lock className="size-4 shrink-0" />}
              <span className="truncate" title={folderLabel(f)}>
                {folderLabel(f)}
              </span>
            </span>
          </FolderControls>
          {!!f.children.length && <div className="ml-4 border-l pl-3">{tree(f.children)}</div>}
        </li>
      ))}
    </ul>
  );
  return (
    <section className="max-w-2xl space-y-4 rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Pastas da caixa</h2>
        <FolderControls mailboxId={mailboxId} />
      </div>
      {q.isLoading ? (
        <LoadingState />
      ) : q.error ? (
        <ErrorState onRetry={() => void q.refetch()} />
      ) : (
        tree(q.data ?? [])
      )}
    </section>
  );
}
