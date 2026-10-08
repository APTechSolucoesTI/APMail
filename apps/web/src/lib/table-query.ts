import type { ListQuery } from '@apmail/shared';
export function tableParameters(query: ListQuery) {
  return {
    columns: JSON.stringify(
      Object.fromEntries(
        Object.entries(query.filters)
          .filter(([key]) => key.startsWith('column:'))
          .map(([key, v]) => [key.slice(7), v]),
      ),
    ),
    ...(query.sort ? { column_sort: query.sort.key, column_direction: query.sort.direction } : {}),
  };
}
