export function groupMailboxesByDomain<T extends { email_address: string }>(
  boxes: readonly T[],
): { domain: string; mailboxes: T[] }[] {
  const groups = new Map<string, T[]>();
  for (const box of boxes) {
    const domain = box.email_address.split('@')[1]?.toLowerCase() ?? 'Outras caixas';
    groups.set(domain, [...(groups.get(domain) ?? []), box]);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b, 'pt-BR', { numeric: true }))
    .map(([domain, mailboxes]) => ({
      domain,
      mailboxes: [...mailboxes].sort((a, b) =>
        a.email_address.localeCompare(b.email_address, 'pt-BR', { numeric: true }),
      ),
    }));
}
