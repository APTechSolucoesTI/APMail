import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { Ellipsis, Plus, Pencil, Trash2, Lock, FolderInput } from 'lucide-react';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import { useSocketRoom } from '@/hooks/use-socket-room';
import { useFolderAction } from '@/hooks/use-folder-action';
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
import { FolderDestinationPicker } from './folder-destination-picker';
const nameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .refine((v) => !/[\r\n\0/\\]/.test(v), 'Use um nome sem barras ou quebras de linha.'),
});
export function FolderControls({
  mailboxId,
  folder,
  children,
  compact = false,
  disabled = false,
}: {
  mailboxId: string;
  folder?: Folder;
  children?: ReactNode;
  compact?: boolean;
  disabled?: boolean;
}) {
  const [menu, setMenu] = useState(false),
    [edit, setEdit] = useState<'create' | 'rename' | 'move' | null>(null),
    [remove, setRemove] = useState(false);
  const action = useFolderAction(mailboxId, folder);
  const { pending, error } = action;
  const busy = disabled || action.busy;
  const enqueue = async (...args: Parameters<typeof action.enqueue>) => {
    await action.enqueue(...args);
    setEdit(null);
    setRemove(false);
  };
  return (
    <div className="min-w-0">
      <div
        className="group/folder-actions flex min-w-0 items-center gap-1"
        onContextMenu={(e) => {
          e.preventDefault();
          if (busy) return;
          setMenu(true);
        }}
        onKeyDown={(e) => {
          if (!busy && e.shiftKey && e.key === 'F10') {
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
              disabled={busy}
              aria-label={folder ? 'Opções da pasta ' + folderLabel(folder) : 'Criar pasta'}
              className={
                compact
                  ? 'size-11 shrink-0 lg:size-8 lg:opacity-0 lg:group-hover/folder-actions:opacity-100 lg:group-focus-within/folder-actions:opacity-100 data-[state=open]:opacity-100'
                  : undefined
              }
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
                    <DropdownMenuItem onSelect={() => setEdit('move')}>
                      <FolderInput />
                      Mover para…
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
              {edit === 'move'
                ? 'Mover pasta'
                : edit === 'rename'
                  ? 'Renomear pasta'
                  : folder
                    ? 'Criar subpasta'
                    : 'Criar pasta'}
            </DialogTitle>
            <DialogDescription>
              {folder
                ? 'Pasta atual: ' + folderLabel(folder)
                : 'A nova pasta será criada na raiz da caixa.'}
            </DialogDescription>
          </DialogHeader>
          {edit === 'move' && folder ? (
            <FolderMoveForm
              mailboxId={mailboxId}
              folder={folder}
              onMove={(parentId) => enqueue('move', folder.name, parentId)}
              onCancel={() => setEdit(null)}
            />
          ) : (
            edit && (
              <SchemaForm
                schema={nameSchema}
                defaults={{ name: edit === 'rename' ? folder?.name : '' }}
                fields={[{ name: 'name', label: 'Nome da pasta' }]}
                cancelLabel="Cancelar"
                onSubmit={async (b) => enqueue(edit, String(b.name))}
              />
            )
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
function FolderMoveForm({
  mailboxId,
  folder,
  onMove,
  onCancel,
}: {
  mailboxId: string;
  folder: Folder;
  onMove: (parentId: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const tenant = useTenantId();
  const q = useQuery({
    queryKey: ['folders', tenant, mailboxId],
    queryFn: () => api<Folder[]>('/mailboxes/' + mailboxId + '/folders'),
    staleTime: 0,
  });
  const [target, setTarget] = useState(folder.parent_id ?? ''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const rows = flattenFolders(q.data ?? []);
  const blocked = new Set([folder.id]);
  let added = true;
  while (added) {
    added = false;
    for (const f of rows)
      if (f.parent_id && blocked.has(f.parent_id) && !blocked.has(f.id)) {
        blocked.add(f.id);
        added = true;
      }
  }
  const source = rows.find((f) => f.id === folder.id);
  const targetParts: string[] = [];
  const seenParents = new Set<string>();
  let targetFolder = rows.find((f) => f.id === target);
  while (targetFolder && !seenParents.has(targetFolder.id)) {
    seenParents.add(targetFolder.id);
    targetParts.unshift(folderLabel(targetFolder));
    targetFolder = rows.find((f) => f.id === targetFolder!.parent_id);
  }
  return q.isLoading ? (
    <LoadingState />
  ) : q.error ? (
    <ErrorState onRetry={() => void q.refetch()} />
  ) : (
    <form
      className="space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || target === (folder.parent_id ?? '')) return;
        setError('');
        setBusy(true);
        try {
          await onMove(target || null);
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : 'Não foi possível mover a pasta. Tente novamente.',
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="text-sm text-muted-foreground">
        A pasta e suas subpastas serão movidas juntas. Os e-mails serão preservados.
      </p>
      <FolderDestinationPicker
        mailboxId={mailboxId}
        folders={q.data ?? []}
        value={{
          mailboxId,
          folderId: target || null,
          path: target ? targetParts.join(' / ') || 'Pasta atual' : 'Raiz da caixa',
        }}
        onChange={(destination) => setTarget(destination.folderId ?? '')}
        allowRoot
        excludeIds={blocked}
        canSelectFolder={(f) =>
          f.id === folder.parent_id ||
          source?.is_local === undefined ||
          f.is_local === source.is_local
        }
        disabled={busy}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          Cancelar
        </Button>
        <Button type="submit" disabled={busy || target === (folder.parent_id ?? '')}>
          {busy ? 'Enviando…' : 'Mover pasta'}
        </Button>
      </div>
    </form>
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
