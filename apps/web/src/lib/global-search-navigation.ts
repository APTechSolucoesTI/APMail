import type { GlobalSearchResponse } from '@apmail/shared';

/** Router receives pathname and query separately; a URL in `to` loses route search state. */
export function searchDestination(url: string) {
  const destination = new URL(url, 'https://apmail.local');
  if (destination.origin !== 'https://apmail.local' || !url.startsWith('/'))
    throw new Error('Destino de pesquisa inválido.');
  return { to: destination.pathname, search: Object.fromEntries(destination.searchParams) };
}

export function uniqueSearchGroups(groups: GlobalSearchResponse['groups']) {
  const seen = new Set<string>();
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => {
        const key = item.category + ':' + item.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    }))
    .filter((group) => group.items.length);
}
