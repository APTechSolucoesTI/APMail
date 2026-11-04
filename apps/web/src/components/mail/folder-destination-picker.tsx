import { useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  ChevronRight,
  ChevronsUpDown,
  Folder as FolderIcon,
  Mailbox as MailboxIcon,
} from 'lucide-react';
import { api } from '@/lib/api';
import { canMailbox, useTenantId, type Mailbox } from '@/lib/auth';
import { flattenFolders, folderLabel, type Folder } from '@/lib/mail';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';

export type FolderDestination = { mailboxId: string; folderId: string | null; path: string };
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR');

/** Browsing never moves mail: an explicit confirmation selects the current path. */
export function FolderDestinationPicker({
  mailboxId,
  folders,
  value,
  onChange,
  allowRoot = false,
  allowMailboxChange = false,
  excludeIds,
  canSelectFolder,
  disabled = false,
}: {
  mailboxId: string;
  folders?: Folder[];
  value: FolderDestination | null;
  onChange: (destination: FolderDestination) => void;
  allowRoot?: boolean;
  allowMailboxChange?: boolean;
  excludeIds?: ReadonlySet<string>;
  canSelectFolder?: (folder: Folder) => boolean;
  disabled?: boolean;
}) {
  const id = useId(),
    tenant = useTenantId();
  const [open, setOpen] = useState(false),
    [browseBox, setBrowseBox] = useState(mailboxId),
    [parentId, setParentId] = useState<string | null>(null),
    [search, setSearch] = useState(''),
    [choosingBox, setChoosingBox] = useState(false);
  const boxes = useQuery({
    queryKey: ['mailboxes', tenant],
    queryFn: () => api<Mailbox[]>('/mailboxes'),
    enabled: open && allowMailboxChange,
  });
  const query = useQuery({
    queryKey: ['folders', tenant, browseBox],
    queryFn: ({ signal }) => api<Folder[]>('/mailboxes/' + browseBox + '/folders', { signal }),
    enabled: open && (!folders || browseBox !== mailboxId),
  });
  const tree = browseBox === mailboxId && folders ? folders : (query.data ?? []);
  const rows = flattenFolders(tree).filter((f) => !excludeIds?.has(f.id));
  const byId = new Map(rows.map((f) => [f.id, f]));
  const ancestors = (folder: Folder) => {
    const parts: Folder[] = [],
      seen = new Set<string>();
    let current: Folder | undefined = folder;
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      parts.unshift(current);
      current = current.parent_id ? byId.get(current.parent_id) : undefined;
    }
    return parts;
  };
  const current = parentId ? byId.get(parentId) : undefined;
  const breadcrumbs = current ? ancestors(current) : [];
  const path = (folder: Folder) => ancestors(folder).map(folderLabel).join(' / ');
  const currentPath = current ? path(current) : 'Raiz da caixa';
  const box = boxes.data?.find((b) => b.id === browseBox);
  const words = normalize(search).trim().split(/\s+/).filter(Boolean);
  const visible = rows.filter((f) =>
    words.length
      ? words.every((word) => normalize(path(f)).includes(word))
      : f.parent_id === parentId || (!parentId && !byId.has(f.parent_id ?? '')),
  );
  const eligibleBoxes = (boxes.data ?? []).filter(
    (b) => canMailbox(b, 'organize') && canMailbox(b, 'move'),
  );
  const loadRemote = browseBox !== mailboxId || !folders;
  const canConfirm =
    !choosingBox &&
    (!loadRemote || (!query.isPending && !query.isError)) &&
    (current ? canSelectFolder?.(current) !== false : allowRoot);
  const navigate = (folderId: string | null) => {
    setParentId(folderId);
    setSearch('');
  };
  return (
    <div className="min-w-0 space-y-2">
      <Label htmlFor={id}>Pasta de destino</Label>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (next) {
            setBrowseBox(value?.mailboxId ?? mailboxId);
            setParentId(value?.folderId ?? null);
            setSearch('');
            setChoosingBox(false);
          }
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            role="combobox"
            aria-label="Pasta de destino"
            aria-expanded={open}
            variant="outline"
            disabled={disabled}
            className="h-auto min-h-11 w-full justify-between gap-2 text-left"
          >
            <FolderIcon className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 whitespace-normal break-words">
              {value?.path ?? 'Selecione uma pasta'}
            </span>
            <ChevronsUpDown className="size-4 shrink-0" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="flex max-h-[var(--radix-popover-content-available-height)] w-[var(--radix-popover-trigger-width)] min-w-0 max-w-[calc(100vw-2rem)] flex-col overflow-hidden p-0"
        >
          {allowMailboxChange && (
            <div className="flex shrink-0 items-center justify-between gap-2 border-b p-2">
              <span
                className="min-w-0 truncate text-xs text-muted-foreground"
                title={box?.email_address}
              >
                {box?.name ?? 'Caixa atual'}
                {box?.email_address ? ' · ' + box.email_address : ''}
              </span>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-10 shrink-0"
                onClick={() => {
                  setChoosingBox(!choosingBox);
                  setSearch('');
                }}
              >
                {choosingBox ? 'Ver pastas' : 'Trocar caixa'}
              </Button>
            </div>
          )}
          {!choosingBox && (
            <nav
              aria-label="Caminho da pasta"
              className="flex max-h-28 shrink-0 flex-wrap items-center gap-1 overflow-y-auto border-b p-2"
            >
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-10"
                disabled={!parentId}
                onClick={() => navigate(current?.parent_id ?? null)}
                aria-label="Voltar para pasta anterior"
              >
                <ArrowLeft className="size-4" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="min-h-10"
                onClick={() => navigate(null)}
              >
                Raiz
              </Button>
              {breadcrumbs.map((f) => (
                <span key={f.id} className="inline-flex min-w-0 items-center">
                  <ChevronRight className="size-3 shrink-0" />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
                    onClick={() => navigate(f.id)}
                  >
                    {folderLabel(f)}
                  </Button>
                </span>
              ))}
            </nav>
          )}
          <Command shouldFilter={false} className="min-h-0 flex-1">
            <CommandInput
              aria-label={choosingBox ? 'Buscar caixa' : 'Buscar pasta pelo caminho completo'}
              placeholder={choosingBox ? 'Buscar caixa…' : 'Buscar em todas as pastas…'}
              value={search}
              onValueChange={setSearch}
            />
            <CommandList className="max-h-[min(40dvh,300px)]">
              {choosingBox ? (
                boxes.isPending ? (
                  <p role="status" className="p-4 text-sm">
                    Carregando caixas…
                  </p>
                ) : boxes.isError ? (
                  <p role="alert" className="p-4 text-sm">
                    Não foi possível carregar as caixas.{' '}
                    <button
                      type="button"
                      className="underline"
                      onClick={() => void boxes.refetch()}
                    >
                      Tentar novamente
                    </button>
                  </p>
                ) : (
                  <>
                    <CommandEmpty>Nenhuma caixa disponível.</CommandEmpty>
                    <CommandGroup>
                      {eligibleBoxes
                        .filter((b) =>
                          words.every((word) =>
                            normalize(b.name + ' ' + b.email_address).includes(word),
                          ),
                        )
                        .map((b) => (
                          <CommandItem
                            key={b.id}
                            value={b.id}
                            className="min-h-11"
                            onSelect={() => {
                              setBrowseBox(b.id);
                              setParentId(null);
                              setSearch('');
                              setChoosingBox(false);
                            }}
                          >
                            <MailboxIcon />
                            <span className="min-w-0 whitespace-normal break-words">
                              {b.name}
                              <span className="block text-xs text-muted-foreground">
                                {b.email_address}
                              </span>
                            </span>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </>
                )
              ) : loadRemote && query.isPending ? (
                <p role="status" className="p-4 text-sm">
                  Carregando pastas…
                </p>
              ) : loadRemote && query.isError ? (
                <p role="alert" className="p-4 text-sm">
                  Não foi possível carregar as pastas.{' '}
                  <button type="button" className="underline" onClick={() => void query.refetch()}>
                    Tentar novamente
                  </button>
                </p>
              ) : (
                <>
                  <CommandEmpty>
                    {search ? 'Nenhuma pasta encontrada.' : 'Esta pasta não tem subpastas.'}
                  </CommandEmpty>
                  <CommandGroup>
                    {visible.map((f) => (
                      <CommandItem
                        key={f.id}
                        value={f.id}
                        className="min-h-11"
                        onSelect={() => navigate(f.id)}
                      >
                        <FolderIcon />
                        <span className="min-w-0 flex-1 whitespace-normal break-words">
                          {folderLabel(f)}
                          {search && (
                            <span className="block text-xs text-muted-foreground">{path(f)}</span>
                          )}
                        </span>
                        <ChevronRight className="size-4 shrink-0" />
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
          {!choosingBox && (
            <div className="shrink-0 space-y-2 border-t p-3">
              <p className="break-words text-xs text-muted-foreground">Destino: {currentPath}</p>
              {current && canSelectFolder?.(current) === false && (
                <p className="text-xs text-muted-foreground">
                  Esta pasta não pode receber a pasta de origem. Navegue até um destino compatível.
                </p>
              )}
              <Button
                type="button"
                className="min-h-11 w-full"
                disabled={!canConfirm}
                onClick={() => {
                  onChange({
                    mailboxId: browseBox,
                    folderId: current?.id ?? null,
                    path: (allowMailboxChange && box ? box.name + ' / ' : '') + currentPath,
                  });
                  setOpen(false);
                }}
              >
                <Check className="size-4" />
                {current ? 'Selecionar esta pasta' : 'Selecionar raiz da caixa'}
              </Button>
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
