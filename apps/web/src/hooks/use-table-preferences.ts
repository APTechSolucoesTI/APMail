import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import type { ListQuery } from '@apmail/shared';
export type TableConfig = { visible: string[]; order: string[]; pageSize: ListQuery['pageSize'] };
export const TableUserContext = createContext<string | null>(null);
export function useTablePreferences(listKey: string, defaults: TableConfig) {
  const userId = useContext(TableUserContext);
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
  useEffect(() => {
    if (!userId) return;
    let active = true;
    void api<{ config: TableConfig | null }>('/preferences/tables/' + encodeURIComponent(listKey))
      .then((data) => {
        if (active && data.config) setConfig(data.config);
      })
      .catch(() => toast.error('Não foi possível carregar as preferências de colunas.'));
    return () => {
      active = false;
    };
  }, [userId, listKey]);
  const save = (next: TableConfig) => {
    if (userId) {
      void api('/preferences/tables/' + encodeURIComponent(listKey), {
        method: 'PUT',
        body: { config: next },
      })
        .then(() => setConfig(next))
        .catch((e) =>
          toast.error(e instanceof Error ? e.message : 'Não foi possível salvar as colunas.'),
        );
      return;
    }
    localStorage.setItem(`apmail-table:${listKey}`, JSON.stringify(next));
    setConfig(next);
  };
  return { config, save };
}
