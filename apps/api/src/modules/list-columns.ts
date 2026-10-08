import { ApiError } from '../authz/context.js';
import { z } from 'zod';
import { sql, type RawBuilder } from 'kysely';
export function localizedColumn(column: RawBuilder<unknown>, labels: Record<string, string>) {
  return sql`concat_ws(' ',${column}::text,case ${column}::text ${sql.join(
    Object.entries(labels).map(([value, label]) => sql`when ${value} then ${label}`),
    sql` `,
  )} else '' end)`;
}
export function columnFilters(
  raw: unknown,
  columns: Record<string, RawBuilder<unknown>>,
): RawBuilder<boolean> {
  const value = z.object({ columns: z.string().max(16000).optional() }).parse(raw).columns;
  const filters = z
      .record(z.string().max(80), z.array(z.string().max(200)).max(1))
      .parse(value ? parseColumns(value) : {}),
    parts: RawBuilder<boolean>[] = [];
  for (const [key, values] of Object.entries(filters)) {
    const column = columns[key];
    if (!column) throw new ApiError(400, 'validation_error', 'Coluna não permitida.');
    if (values[0])
      parts.push(
        sql<boolean>`unaccent(coalesce(${column}::text,'')) ilike unaccent(${'%' + values[0].replace(/[%_\\]/g, '\\$&') + '%'})`,
      );
  }
  return parts.length ? sql<boolean>`(${sql.join(parts, sql` and `)})` : sql<boolean>`true`;
}
export function columnOrder(
  raw: unknown,
  columns: Record<string, RawBuilder<unknown>>,
  fallback: RawBuilder<unknown>,
) {
  const q = z
    .object({
      column_sort: z.string().max(80).optional(),
      column_direction: z.enum(['asc', 'desc']).default('asc'),
    })
    .parse(raw);
  if (!q.column_sort) return fallback;
  const column = columns[q.column_sort];
  if (!column) throw new ApiError(400, 'validation_error', 'Coluna não ordenável.');
  return sql`${column} ${q.column_direction === 'asc' ? sql`asc` : sql`desc`}`;
}

function parseColumns(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new ApiError(400, 'validation_error', 'Filtros inválidos.');
  }
}
