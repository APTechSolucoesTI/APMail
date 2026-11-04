/** The first valid date token narrows the text search to a local calendar range. */
export function mailSearchTerms(query = ''): { text: string; from?: string; until?: string } {
  const tokens = query.trim().split(/\s+/);
  for (const [index, token] of tokens.entries()) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(token);
    const dayFirst = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(token);
    const monthFirst = /^(\d{2})\/(\d{4})$/.exec(token);
    if (!iso && !dayFirst && !monthFirst && !/^\d{4}$/.test(token)) continue;
    const year = Number(iso?.[1] ?? dayFirst?.[3] ?? monthFirst?.[2] ?? token);
    const month = Number(iso?.[2] ?? dayFirst?.[2] ?? monthFirst?.[1] ?? 1);
    const day = Number(iso?.[3] ?? dayFirst?.[1] ?? 1);
    if (year < 1900 || year > 2199 || month < 1 || month > 12 || day < 1 || day > 31) continue;
    const from = new Date(Date.UTC(year, month - 1, day));
    if (from.getUTCDate() !== day || from.getUTCMonth() !== month - 1) continue;
    const until =
      iso || dayFirst
        ? new Date(Date.UTC(year, month - 1, day + 1))
        : monthFirst
          ? new Date(Date.UTC(year, month, 1))
          : new Date(Date.UTC(year + 1, 0, 1));
    return {
      text: tokens.filter((_, position) => position !== index).join(' '),
      from: from.toISOString().slice(0, 10),
      until: until.toISOString().slice(0, 10),
    };
  }
  return { text: query.trim() };
}
