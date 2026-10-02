import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useTenantId } from '@/lib/auth';
import type { Folder } from '@/lib/mail';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { LoadingState, ErrorState } from '@/components/data/data-state';
export type FolderAccess = { restrict_to_folders: boolean; folder_ids: string[] };
export function FolderAccessPicker({
  mailboxId,
  value,
  onChange,
  disabled = false,
  platformTenantId,
}: {
  mailboxId: string;
  value: FolderAccess;
  onChange: (value: FolderAccess) => void;
  disabled?: boolean;
  platformTenantId?: string;
}) {
  const id = useId(),
    tenant = useTenantId(),
    folders = useQuery({
      queryKey: ['folders', platformTenantId ?? tenant, mailboxId, !!platformTenantId],
      queryFn: ({ signal }) =>
        api<Folder[]>(
          platformTenantId
            ? '/superadmin/tenants/' + platformTenantId + '/folders/' + mailboxId
            : '/mailboxes/' + mailboxId + '/folders',
          { signal },
        ),
      enabled: value.restrict_to_folders,
    });
  const tree = (nodes: Folder[]) => (
    <ul className="space-y-1">
      {nodes.map((folder) => (
        <li key={folder.id}>
          <div className="flex min-h-11 items-center gap-2">
            <Checkbox
              id={id + folder.id}
              checked={value.folder_ids.includes(folder.id)}
              disabled={disabled}
              onCheckedChange={(checked) =>
                onChange({
                  ...value,
                  folder_ids:
                    checked === true
                      ? [...value.folder_ids, folder.id]
                      : value.folder_ids.filter((x) => x !== folder.id),
                })
              }
            />
            <Label
              htmlFor={id + folder.id}
              className="min-w-0 flex-1 break-words text-sm font-normal"
            >
              {folder.name}
            </Label>
          </div>
          {folder.children.length > 0 && (
            <div className="border-l pl-4">{tree(folder.children)}</div>
          )}
        </li>
      ))}
    </ul>
  );
  return (
    <div className="space-y-2">
      <div className="flex min-h-11 items-center gap-2">
        <Checkbox
          id={id}
          disabled={disabled}
          checked={value.restrict_to_folders}
          onCheckedChange={(checked) =>
            onChange({ ...value, restrict_to_folders: checked === true })
          }
        />
        <Label htmlFor={id}>Restringir a pastas específicas</Label>
      </div>
      {value.restrict_to_folders && (
        <>
          <p className="text-xs text-muted-foreground">
            Subpastas herdam o acesso. Sem seleção, nenhuma mensagem fica disponível.
          </p>
          <div className="max-h-64 overflow-y-auto rounded-md border p-3">
            {folders.isLoading ? (
              <LoadingState />
            ) : folders.data ? (
              folders.data.length ? (
                tree(folders.data)
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhuma pasta disponível. Sincronize a caixa primeiro.
                </p>
              )
            ) : (
              <ErrorState onRetry={() => void folders.refetch()} />
            )}
          </div>
        </>
      )}
    </div>
  );
}
