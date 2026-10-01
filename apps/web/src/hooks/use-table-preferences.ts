import { useState } from 'react';
import type { ListQuery } from '@apmail/shared';
export type TableConfig = { visible: string[]; order: string[]; pageSize: ListQuery['pageSize'] };
// Na Fase 0, preferências são locais; a Fase 1 substitui por persistência autenticada.
export function useTablePreferences(listKey: string, defaults: TableConfig) {
  const [config, setConfig] = useState<TableConfig>(() => {
    try {
      const saved = JSON.parse(
        localStorage.getItem(`apmail-table:${listKey}`) ?? 'null',
      ) as TableConfig | null;
      return saved && Array.isArray(saved.visible) && Array.isArray(saved.order) ? saved : defaults;
    } catch {
      return defaults;
    }
  });
  const save = (next: TableConfig) => {
    localStorage.setItem(`apmail-table:${listKey}`, JSON.stringify(next));
    setConfig(next);
  };
  return { config, save };
}
