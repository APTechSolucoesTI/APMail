import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { ACCESS_PERMISSIONS, permissionDependencies, type AccessPermission } from '@apmail/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';

type PermissionDefinition = {
  key: AccessPermission;
  parent?: string;
  group: string;
  label: string;
  description: string;
};
const definitions: readonly PermissionDefinition[] = ACCESS_PERMISSIONS;
const definition = (key: AccessPermission) =>
  definitions.find((permission) => permission.key === key);
const parentOf = (permission: PermissionDefinition) =>
  permission.parent ??
  // Older catalogues still expose the same hierarchy through their dependencies.
  permissionDependencies[permission.key]?.find((key) => key === permission.key.split('.')[0]);

function prerequisites(
  key: AccessPermission,
  seen = new Set<AccessPermission>(),
): Set<AccessPermission> {
  if (seen.has(key)) return seen;
  seen.add(key);
  const parent = definitions.find((permission) => permission.key === definition(key)?.parent)?.key;
  for (const required of [...(permissionDependencies[key] ?? []), ...(parent ? [parent] : [])]) {
    prerequisites(required, seen);
  }
  return seen;
}

/** Selecting a category grants only that permission and prerequisites, never its children. */
export function PermissionPicker({
  value,
  onChange,
  allowedPermissions,
  disabled = false,
}: {
  value: AccessPermission[];
  onChange: (permissions: AccessPermission[]) => void;
  allowedPermissions?: readonly string[] | null;
  disabled?: boolean;
}) {
  const id = useId();
  const [collapsed, setCollapsed] = useState<Set<AccessPermission>>(new Set());
  function toggle(key: AccessPermission, checked: boolean) {
    const next = checked
      ? [...new Set([...value, ...prerequisites(key)])]
      : value.filter((permission) => !prerequisites(permission).has(key));
    onChange(next);
  }
  function renderPermission(permission: PermissionDefinition) {
    const children = definitions.filter((candidate) => parentOf(candidate) === permission.key);
    const open = !collapsed.has(permission.key);
    const selected = value.includes(permission.key);
    const unavailable =
      allowedPermissions != null &&
      [...prerequisites(permission.key)].some((required) => !allowedPermissions.includes(required));
    return (
      <div key={permission.key}>
        <div className="flex items-start gap-1 rounded-md p-2 hover:bg-muted/50">
          <label
            htmlFor={id + permission.key}
            className="flex min-h-10 min-w-0 flex-1 cursor-pointer items-start gap-3"
          >
            <Checkbox
              className="mt-1"
              id={id + permission.key}
              aria-label={permission.label}
              aria-describedby={id + '-help-' + permission.key}
              checked={selected}
              disabled={disabled || (unavailable && !selected)}
              onCheckedChange={(checked) => toggle(permission.key, checked === true)}
            />
            <span className={unavailable && !selected ? 'opacity-60' : undefined}>
              <span className="block text-sm font-medium">{permission.label}</span>
              <span
                id={id + '-help-' + permission.key}
                className="mt-1 block text-xs text-muted-foreground"
              >
                {permission.description}
                {unavailable ? ' Não pode ser concedida com seu acesso atual.' : ''}
              </span>
            </span>
          </label>
          {children.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={(open ? 'Recolher' : 'Expandir') + ' ações de ' + permission.label}
              aria-expanded={open}
              aria-controls={id + '-children-' + permission.key}
              onClick={() =>
                setCollapsed((current) => {
                  const next = new Set(current);
                  if (open) next.add(permission.key);
                  else next.delete(permission.key);
                  return next;
                })
              }
            >
              {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
            </Button>
          )}
        </div>
        {children.length > 0 && open && (
          <div
            id={id + '-children-' + permission.key}
            className="ml-4 border-l pl-2 sm:ml-6 sm:pl-3"
          >
            {children.map(renderPermission)}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="font-semibold">
          Telas e ações{' '}
          <span className="font-normal text-muted-foreground">· {value.length} selecionadas</span>
        </p>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || !value.length}
          onClick={() => onChange([])}
        >
          Limpar permissões
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Selecione cada ação necessária. Marcar um módulo permite seu acesso, sem selecionar
        automaticamente as ações do submenu.
      </p>
      {Array.from(new Set(definitions.map((permission) => permission.group))).map((group) => (
        <fieldset key={group} className="rounded-lg border p-2 sm:p-3" disabled={disabled}>
          <legend className="px-1 text-sm font-semibold">{group}</legend>
          {definitions
            .filter((permission) => permission.group === group && !parentOf(permission))
            .map(renderPermission)}
        </fieldset>
      ))}
    </div>
  );
}
