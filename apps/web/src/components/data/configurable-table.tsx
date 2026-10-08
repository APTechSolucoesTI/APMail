import { useEffect, useMemo, useState, useRef, isValidElement, type ReactNode } from 'react';
import { flexRender, tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Ellipsis, Filter } from 'lucide-react';
import type { ListQuery } from '@apmail/shared';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useTablePreferences, type TableConfig } from '@/hooks/use-table-preferences';
import { ColumnSettingsDialog } from './column-settings-dialog';
import { Label } from '@/components/ui/label';
import { SearchInput } from './search-input';
import { FilterPopover, type FilterOption } from './filter-popover';
import { Pagination } from './pagination';
import { LoadingState, EmptyState, ErrorState, NoResultsState } from './data-state';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';

export type ListColumn<T> = {
  id: string;
  header: string;
  cell?: (row: T) => ReactNode;
  value?: (row: T) => string | number | null;
  sortable?: boolean;
  filterable?: boolean;
  filterType?: 'text' | 'date' | 'number';
  align?: 'left' | 'right';
  width?: number;
  hideable?: boolean;
  defaultVisible?: boolean;
  stackOnMobile?: boolean;
};
export type TableFilter = { id: string; label: string; options: FilterOption[] };
export type ConfigurableTableProps<T> = {
  listKey: string;
  groupBy?: (row: T) => number;
  columns: ListColumn<T>[];
  data: T[];
  total?: number;
  query: ListQuery;
  onQueryChange: (query: ListQuery) => void;
  selectable?: boolean;
  selectedIds?: string[];
  onSelectionChange?: (ids: string[]) => void;
  bulkActions?: (selectedIds: string[]) => ReactNode;
  rowActions?: (row: T) => ReactNode;
  toolbarLeft?: ReactNode;
  searchPlaceholder?: string;
  showSearch?: boolean;
  filters?: TableFilter[];
  isLoading?: boolean;
  isFetching?: boolean;
  error?: unknown;
  emptyState?: ReactNode;
  mode: 'client' | 'server';
  onRetry?: () => void;
};
const tableFeatureSet = tableFeatures({});
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
const normalize = (value: unknown) =>
  String(value ?? '')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
const renderedText = (value: ReactNode): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(renderedText).join(' ');
  if (isValidElement<{ children?: ReactNode }>(value)) return renderedText(value.props.children);
  return '';
};
export function ConfigurableTable<T extends { id: string }>(props: ConfigurableTableProps<T>) {
  const { data, query, onQueryChange, selectable = false, mode, filters = [] } = props;
  const columns: ListColumn<T>[] = useMemo(
    () =>
      props.columns.map((c, index) => ({
        ...c,
        hideable: index === 0 ? false : c.hideable,
        sortable: c.sortable ?? true,
      })),
    [props.columns],
  );
  const defaults: TableConfig = {
    visible: columns
      .filter((c) => c.defaultVisible !== false || c.hideable === false)
      .map((c) => c.id),
    order: columns.map((c) => c.id),
    pageSize: 10,
  };
  const preferences = useTablePreferences(props.listKey, defaults),
    restored = useRef('');
  useEffect(() => {
    if (preferences.ready && restored.current !== preferences.identity) {
      restored.current = preferences.identity;
      if (
        query.pageSize === 10 &&
        preferences.config.pageSize !== 10 &&
        !new URLSearchParams(window.location.search).has('pageSize')
      )
        onQueryChange({ ...query, page: 1, pageSize: preferences.config.pageSize });
    }
  }, [
    preferences.ready,
    preferences.identity,
    preferences.config.pageSize,
    props.listKey,
    query,
    onQueryChange,
  ]);
  const [selection, setSelection] = useState<{ context: string; ids: string[] }>({
    context: '',
    ids: [],
  });
  const context = JSON.stringify(query);
  const selected = props.selectedIds ?? (selection.context === context ? selection.ids : []);
  const setSelected = (ids: string[]) => {
    setSelection({ context, ids });
    props.onSelectionChange?.(ids);
  };
  const columnValue = (row: T, column: ListColumn<T>) =>
    column.value ? column.value(row) : (row as Record<string, unknown>)[column.id];
  const searchableValue = (row: T, column: ListColumn<T>) => {
    const raw = columnValue(row, column);
    return [
      typeof raw === 'object' ? JSON.stringify(raw) : raw,
      column.cell ? renderedText(column.cell(row)) : '',
    ].join(' ');
  };
  const filtered = useMemo(() => {
    if (mode === 'server') return data;
    const result = data.filter(
      (row) =>
        (!query.search ||
          columns.some((c) =>
            normalize(searchableValue(row, c)).includes(normalize(query.search)),
          )) &&
        Object.entries(query.filters).every(
          ([key, values]) =>
            values.length === 0 ||
            (key.startsWith('column:')
              ? normalize(
                  searchableValue(
                    row,
                    columns.find((c) => c.id === key.slice(7)) ?? { id: key.slice(7), header: '' },
                  ),
                ).includes(normalize(values[0]))
              : values.includes(String((row as Record<string, unknown>)[key]))),
        ),
    );
    const sort = query.sort;
    if (sort) {
      const column = columns.find((c) => c.id === sort.key && c.sortable);
      if (column)
        result.sort((a, b) => {
          const av = columnValue(a, column);
          const bv = columnValue(b, column);
          const comparison =
            typeof av === 'number' && typeof bv === 'number'
              ? av - bv
              : collator.compare(String(av ?? ''), String(bv ?? ''));
          return sort.direction === 'asc' ? comparison : -comparison;
        });
    }
    if (props.groupBy) result.sort((a, b) => props.groupBy!(a) - props.groupBy!(b));
    return result;
    // columnValue depende somente da definição da coluna recebida.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, data, mode, query.search, query.filters, query.sort, props.groupBy]);
  const total = mode === 'server' ? (props.total ?? data.length) : filtered.length;
  const pages = Math.max(1, Math.ceil(total / query.pageSize));
  useEffect(() => {
    if (!props.isLoading && !props.isFetching && query.page > pages)
      onQueryChange({ ...query, page: pages });
  }, [pages, query, onQueryChange, props.isLoading, props.isFetching]);
  const pageData =
    mode === 'server'
      ? data
      : filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize);
  const order = [
    ...preferences.config.order,
    ...columns.map((c) => c.id).filter((id) => !preferences.config.order.includes(id)),
  ];
  const visible = order
    .map((id) => columns.find((column) => column.id === id))
    .filter(
      (column): column is ListColumn<T> =>
        !!column && (column.hideable === false || preferences.config.visible.includes(column.id)),
    );
  const definitions: ColumnDef<typeof tableFeatureSet, T>[] = visible.map((column) => ({
    id: column.id,
    header: column.header,
    cell: ({ row }) =>
      column.cell?.(row.original) ?? String(columnValue(row.original, column) ?? ''),
  }));
  const table = useTable({
    features: tableFeatureSet,
    data: pageData,
    columns: definitions,
    getRowId: (row) => row.id,
  });
  const toggle = (id: string) =>
    setSelected(
      selected.includes(id) ? selected.filter((value) => value !== id) : [...selected, id],
    );
  const allSelected = pageData.length > 0 && pageData.every((row) => selected.includes(row.id));
  const someSelected = pageData.some((row) => selected.includes(row.id));
  const togglePage = () => setSelected(allSelected ? [] : pageData.map((row) => row.id));
  const activeFilters =
    Object.values(query.filters).filter((value) => value.length > 0).length +
    (query.search ? 1 : 0);
  const clear = () => onQueryChange({ ...query, page: 1, search: '', filters: {} });
  const sortColumn = (column: ListColumn<T>) => {
    const direction =
      query.sort?.key === column.id ? (query.sort.direction === 'asc' ? 'desc' : null) : 'asc';
    onQueryChange({
      ...query,
      page: 1,
      sort: direction ? { key: column.id, direction } : undefined,
    });
  };
  const columnFilter = (column: ListColumn<T>) =>
    column.filterable === false ? null : (
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={'Filtrar ' + column.header}
            aria-pressed={!!query.filters['column:' + column.id]?.[0]}
            className={cn('shrink-0', query.filters['column:' + column.id]?.[0] && 'text-primary')}
          >
            <Filter aria-hidden className="size-3" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 space-y-2" align="start">
          <Label htmlFor={props.listKey + '-filter-' + column.id}>Filtrar {column.header}</Label>
          <SearchInput
            id={props.listKey + '-filter-' + column.id}
            inputType={
              column.filterType === 'date'
                ? 'date'
                : column.filterType === 'number'
                  ? 'number'
                  : 'search'
            }
            placeholder={'Filtrar ' + column.header}
            value={query.filters['column:' + column.id]?.[0] ?? ''}
            debounce={mode === 'client' ? 0 : 400}
            onChange={(value) =>
              onQueryChange({
                ...query,
                page: 1,
                filters: { ...query.filters, ['column:' + column.id]: value ? [value] : [] },
              })
            }
          />
        </PopoverContent>
      </Popover>
    );
  const pagination = (
    <Pagination
      page={query.page}
      pageSize={query.pageSize}
      total={total}
      onPageChange={(page) => onQueryChange({ ...query, page })}
    />
  );
  return (
    <section
      aria-label="Listagem de registros"
      className="rounded-md border bg-card text-card-foreground shadow-card"
    >
      <div className="flex flex-wrap items-center gap-2 border-b p-3">
        {props.toolbarLeft}
        {props.showSearch !== false && (
          <SearchInput
            placeholder={props.searchPlaceholder}
            value={query.search ?? ''}
            onChange={(search) => onQueryChange({ ...query, search, page: 1 })}
            debounce={mode === 'client' ? 0 : 400}
          />
        )}
        {filters.map((filter) => (
          <FilterPopover
            key={filter.id}
            label={filter.label}
            options={filter.options}
            value={query.filters[filter.id] ?? []}
            onChange={(value) =>
              onQueryChange({
                ...query,
                page: 1,
                filters: { ...query.filters, [filter.id]: value },
              })
            }
          />
        ))}
        <div className="flex flex-wrap gap-1 sm:hidden">
          {visible
            .filter((c) => c.filterable !== false)
            .map((c) => (
              <div key={c.id} className="flex items-center gap-1 text-xs">
                {c.header}
                {columnFilter(c)}
              </div>
            ))}
        </div>
        {Object.entries(query.filters)
          .filter(([key, v]) => key.startsWith('column:') && v[0])
          .map(([key, values]) => (
            <Button
              key={key}
              variant="outline"
              size="sm"
              aria-label={'Remover filtro ' + key.slice(7)}
              onClick={() =>
                onQueryChange({ ...query, page: 1, filters: { ...query.filters, [key]: [] } })
              }
            >
              {columns.find((c) => c.id === key.slice(7))?.header ?? key.slice(7)}: {values[0]} ×
            </Button>
          ))}
        {activeFilters > 0 && (
          <Button variant="ghost" size="sm" onClick={clear}>
            Limpar filtros ({activeFilters})
          </Button>
        )}
        <ColumnSettingsDialog
          columns={columns}
          defaults={defaults}
          config={{ ...preferences.config, pageSize: query.pageSize }}
          onApply={(config) => {
            preferences.save(config);
            onQueryChange({ ...query, pageSize: config.pageSize, page: 1 });
          }}
        />
      </div>
      {selected.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-3 border-b bg-muted p-3 text-sm"
          role="status"
        >
          <span>{selected.length} selecionados na página atual</span>
          {props.bulkActions?.(selected)}
          <Button variant="ghost" size="sm" onClick={() => setSelected([])}>
            Limpar seleção
          </Button>
        </div>
      )}
      {pagination}
      {props.isFetching && (
        <p role="status" className="px-3 pb-2 text-xs text-muted-foreground">
          Atualizando dados…
        </p>
      )}
      {props.isLoading ? (
        <LoadingState />
      ) : props.error ? (
        <ErrorState onRetry={props.onRetry ?? (() => onQueryChange({ ...query }))} />
      ) : pageData.length === 0 ? (
        activeFilters > 0 ? (
          <NoResultsState count={activeFilters} onClear={clear} />
        ) : (
          (props.emptyState ?? (
            <EmptyState
              title="Nenhum registro"
              description="Os registros serão exibidos aqui quando forem cadastrados."
            />
          ))
        )
      ) : (
        <>
          <div className="hidden max-h-[calc(100dvh-16rem)] overflow-auto sm:block">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-card">
                <TableRow>
                  {selectable && (
                    <TableHead className="h-8 w-10 px-2">
                      <Checkbox
                        aria-label="Selecionar itens da página atual"
                        checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                        onCheckedChange={togglePage}
                      />
                    </TableHead>
                  )}
                  {visible.map((column) => (
                    <TableHead
                      key={column.id}
                      aria-sort={
                        column.sortable
                          ? query.sort?.key === column.id
                            ? query.sort.direction === 'asc'
                              ? 'ascending'
                              : 'descending'
                            : 'none'
                          : undefined
                      }
                      className={cn(
                        'h-8 px-2 text-[11px] font-semibold uppercase tracking-wide',
                        column.align === 'right' && 'text-right',
                      )}
                    >
                      <div className="inline-flex items-center gap-1">
                        {column.sortable ? (
                          <button
                            type="button"
                            className={cn(
                              'inline-flex min-h-8 items-center gap-1 font-semibold focus-visible:rounded-sm',
                              column.align === 'right' && 'justify-end',
                            )}
                            onClick={() => sortColumn(column)}
                          >
                            {column.header}
                            {query.sort?.key === column.id ? (
                              query.sort.direction === 'asc' ? (
                                <ArrowUp className="size-3" aria-hidden="true" />
                              ) : (
                                <ArrowDown className="size-3" aria-hidden="true" />
                              )
                            ) : (
                              <ArrowUpDown
                                className="size-3 text-muted-foreground"
                                aria-hidden="true"
                              />
                            )}
                          </button>
                        ) : (
                          column.header
                        )}
                        {columnFilter(column)}
                      </div>
                    </TableHead>
                  ))}
                  {props.rowActions && (
                    <TableHead className="h-8 w-20 px-2 text-[11px] font-semibold uppercase">
                      Ações
                    </TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    className={cn('hover:bg-muted/50', selected.includes(row.id) && 'bg-muted')}
                  >
                    {selectable && (
                      <TableCell className="px-2 py-1.5">
                        <Checkbox
                          aria-label={`Selecionar registro ${row.id}`}
                          checked={selected.includes(row.id)}
                          onCheckedChange={() => toggle(row.id)}
                        />
                      </TableCell>
                    )}
                    {row.getAllCells().map((cell) => {
                      const column = visible.find((c) => c.id === cell.column.id);
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            'px-2 py-1.5 text-xs',
                            column?.align === 'right' && 'text-right tabular-nums',
                          )}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })}
                    {props.rowActions && (
                      <TableCell className="w-20 px-2 py-1.5">
                        <div className="flex items-center">{props.rowActions(row.original)}</div>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="space-y-2 border-t p-3 sm:hidden">
            {selectable && (
              <label className="flex min-h-11 items-center gap-3 text-sm">
                <Checkbox
                  aria-label="Selecionar itens da página atual no celular"
                  checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                  onCheckedChange={togglePage}
                />
                Selecionar página atual
              </label>
            )}
            {pageData.map((row) => (
              <article
                key={row.id}
                className={cn('rounded-md border p-3', selected.includes(row.id) && 'bg-muted')}
              >
                {selectable && (
                  <label className="mb-2 flex min-h-11 items-center gap-3 text-sm">
                    <Checkbox
                      aria-label={`Selecionar registro ${row.id} no celular`}
                      checked={selected.includes(row.id)}
                      onCheckedChange={() => toggle(row.id)}
                    />
                    Selecionar
                  </label>
                )}
                <dl className="space-y-2">
                  {visible.map((column) => (
                    <div
                      key={column.id}
                      className={cn(
                        'flex text-xs',
                        column.stackOnMobile
                          ? 'flex-col gap-2'
                          : 'items-start justify-between gap-3',
                      )}
                    >
                      <dt className="font-semibold text-muted-foreground">{column.header}</dt>
                      <dd
                        className={cn(
                          'min-w-0 break-words',
                          column.stackOnMobile ? 'text-left' : 'flex-1 text-right',
                        )}
                      >
                        {column.cell?.(row) ?? String(columnValue(row, column) ?? '')}
                      </dd>
                    </div>
                  ))}
                </dl>
                {props.rowActions && (
                  <div className="mt-3 flex justify-end border-t pt-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          aria-label={`Mais ações do registro ${row.id}`}
                        >
                          <Ellipsis />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent align="end" className="w-auto">
                        <div
                          className="flex flex-wrap items-center gap-2"
                          role="group"
                          aria-label="Ações do registro"
                        >
                          {props.rowActions(row)}
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      {pagination}
    </section>
  );
}
