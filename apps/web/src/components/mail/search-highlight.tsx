import { normalizeRuleText } from '@apmail/shared';
export function SearchHighlight({ text, query }: { text: string; query?: string }) {
  const terms = (query ?? '')
    .split(/\s+/)
    .map((t) => normalizeRuleText(t.replace(/["()]/g, '')))
    .filter((t) => t.length > 1)
    .sort((a, b) => b.length - a.length);
  if (!terms.length) return <>{text}</>;
  const normalized = normalizeRuleText(text),
    segments: React.ReactNode[] = [];
  let cursor = 0,
    plain = 0;
  while (cursor < text.length) {
    const match = terms.find((t) => normalized.startsWith(t, cursor));
    if (match) {
      if (cursor > plain) segments.push(text.slice(plain, cursor));
      segments.push(
        <mark key={cursor} className="rounded-sm bg-warning-bg text-warning-fg">
          {text.slice(cursor, cursor + match.length)}
        </mark>,
      );
      cursor += match.length;
      plain = cursor;
    } else cursor++;
  }
  if (plain < text.length) segments.push(text.slice(plain));
  return <>{segments}</>;
}
