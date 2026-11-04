import { useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery, type QueryKey } from '@tanstack/react-query';
import type { ContactResolution } from '@apmail/shared';
import { api } from '@/lib/api';

type MailPage<T> = { items: T[]; total: number; contacts?: ContactResolution };
export const MAIL_BULK_LIMIT = 100;

/** Zero is the UI preference for no page limit; requests are always bounded. */
export function useMailPages<T extends { id: string; message_id?: string | null }>({
  path,
  key,
  params,
  page,
  size,
  enabled,
  refetchInterval,
}: {
  path: string;
  key: QueryKey;
  params: URLSearchParams;
  page: number;
  size: number;
  enabled?: boolean;
  refetchInterval?: number;
}) {
  const unlimited = size === 0;
  const result = useInfiniteQuery({
    queryKey: [...key, params.toString()],
    initialPageParam: unlimited ? 1 : page,
    queryFn: ({ pageParam, signal }) => {
      if (!unlimited) return api<MailPage<T>>(path + '?' + params);
      const bounded = new URLSearchParams(params);
      bounded.set('page', String(pageParam));
      bounded.set('page_size', '200');
      return api<MailPage<T>>(path + '?' + bounded, { signal });
    },
    getNextPageParam: (last, pages, pageParam) =>
      unlimited &&
      last.items.length > 0 &&
      pages.reduce((count, current) => count + current.items.length, 0) < last.total
        ? pageParam + 1
        : undefined,
    placeholderData: keepPreviousData,
    enabled,
    refetchInterval: unlimited ? false : refetchInterval,
    refetchOnWindowFocus: !unlimited,
  });
  const data = useMemo(() => {
    if (!result.data) return undefined;
    const items = new Map<string, T>();
    const contacts: ContactResolution = {};
    for (const current of result.data.pages) {
      for (const item of current.items) items.set(item.message_id ?? item.id, item);
      Object.assign(contacts, current.contacts);
    }
    return {
      items: [...items.values()],
      total: result.data.pages.at(-1)?.total ?? 0,
      contacts,
    };
  }, [result.data]);
  return { ...result, data };
}
