import { ArrowDown, ArrowUp, Settings2 } from 'lucide-react';
import { useState } from 'react';
import { PAGE_SIZES, type ListQuery } from '@apmail/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { TableConfig } from '@/hooks/use-table-preferences';
export type ColumnSetting = { id: string; header: string; hideable?: boolean };
export function ColumnSettingsDialog({
  columns,
  config,
  defaults,
  onApply,
}: {
  columns: ColumnSetting[];
  config: TableConfig;
  defaults: TableConfig;
  onApply: (config: TableConfig) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings2 aria-hidden="true" />
          Colunas
        </Button>
      </DialogTrigger>
      {open && (
        <ColumnDraft
          columns={columns}
          config={config}
          defaults={defaults}
          onApply={(next) => {
            onApply(next);
            setOpen(false);
          }}
          onCancel={() => setOpen(false)}
        />
      )}
    </Dialog>
  );
}
function ColumnDraft({
  columns,
  config,
  defaults,
  onApply,
  onCancel,
}: {
  columns: ColumnSetting[];
  config: TableConfig;
  defaults: TableConfig;
  onApply: (config: TableConfig) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(config);
  const ordered = [
    ...draft.order.filter((id) => columns.some((c) => c.id === id)),
    ...columns.map((c) => c.id).filter((id) => !draft.order.includes(id)),
  ];
  const move = (index: number, delta: number) => {
    const order = [...ordered];
    const target = index + delta;
    const a = order[index];
    const b = order[target];
    if (!a || !b) return;
    order[index] = b;
    order[target] = a;
    setDraft({ ...draft, order });
  };
  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Configurar colunas</DialogTitle>
        <DialogDescription>Escolha as informações e a ordem desta listagem.</DialogDescription>
      </DialogHeader>
      <div className="space-y-1">
        {ordered.map((id, index) => {
          const column = columns.find((c) => c.id === id);
          if (!column) return null;
          const lastVisible = draft.visible.length === 1 && draft.visible.includes(id);
          return (
            <div key={id} className="flex min-h-11 items-center gap-3">
              <label className="flex flex-1 items-center gap-3 text-sm">
                <Checkbox
                  checked={draft.visible.includes(id)}
                  disabled={column.hideable === false || lastVisible}
                  onCheckedChange={(checked) =>
                    setDraft({
                      ...draft,
                      visible: checked
                        ? [...draft.visible, id]
                        : draft.visible.filter((c) => c !== id),
                    })
                  }
                />
                {column.header}
              </label>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Mover ${column.header} para cima`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Mover ${column.header} para baixo`}
                disabled={index === ordered.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown />
              </Button>
            </div>
          );
        })}
      </div>
      <div className="space-y-2">
        <Label htmlFor="table-page-size">Registros por página</Label>
        <select
          id="table-page-size"
          value={draft.pageSize}
          onChange={(event) =>
            setDraft({ ...draft, pageSize: Number(event.target.value) as ListQuery['pageSize'] })
          }
          className="h-11 w-full rounded-md border border-input bg-background px-3 text-sm"
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
      </div>
      <DialogFooter className="gap-2">
        <Button variant="ghost" onClick={() => setDraft(defaults)}>
          Restaurar padrão
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancelar
        </Button>
        <Button onClick={() => onApply({ ...draft, order: ordered })}>Aplicar</Button>
      </DialogFooter>
    </DialogContent>
  );
}
