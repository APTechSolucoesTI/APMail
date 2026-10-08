import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import { tableConfigSchema, type ListQuery } from '@apmail/shared';
export type TableConfig = { visible: string[]; order: string[]; pageSize: ListQuery['pageSize'] };
export const TableUserContext = createContext<string | null>(null);
export function useTablePreferences(listKey: string, defaults: TableConfig) {
  const userId = useContext(TableUserContext),
    key = `apmail-table:${userId ?? 'anonymous'}:${listKey}`;
  const read = () => {
    try {
      const parsed = tableConfigSchema.safeParse(JSON.parse(localStorage.getItem(key) ?? 'null'));
      return parsed.success ? parsed.data : defaults;
    } catch {
      return defaults;
    }
  };
  const [state, setState] = useState(() => ({
    key,
    config: userId ? defaults : read(),
    ready: !userId,
  }));
  const current = state.key === key ? state : { key, config: defaults, ready: false };
  useEffect(() => {
    let active = true;
    if (!userId) {
      setState({ key, config: read(), ready: true });
      return;
    }
    void api<{ config: TableConfig | null }>('/preferences/tables/' + encodeURIComponent(listKey))
      .then((data) => {
        if (!active) return;
        const parsed = tableConfigSchema.safeParse(data.config);
        setState({ key, config: parsed.success ? parsed.data : defaults, ready: true });
      })
      .catch(() => {
        if (active) {
          setState({ key, config: defaults, ready: true });
          toast.error('Não foi possível carregar as preferências de colunas.');
        }
      });
    return () => {
      active = false;
    };
    // Definitions are reconciled by the table; changing user or list always reloads its own preferences.
  }, [userId, listKey, key]);
  const save = (next: TableConfig) => {
    const parsed = tableConfigSchema.parse(next);
    if (userId) {
      void api('/preferences/tables/' + encodeURIComponent(listKey), {
        method: 'PUT',
        body: { config: parsed },
      })
        .then(() =>
          setState((current) =>
            current.key === key ? { key, config: parsed, ready: true } : current,
          ),
        )
        .catch((e) => toast.error((e as Error).message));
    } else {
      localStorage.setItem(key, JSON.stringify(parsed));
      setState({ key, config: parsed, ready: true });
    }
  };
  return { config: current.config, ready: current.ready, identity: key, save };
}
