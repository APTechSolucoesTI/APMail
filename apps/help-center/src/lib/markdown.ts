import type { Heading } from './types';

export type MarkdownBlock =
  | { type: 'heading'; level: 2 | 3; text: string; id: string }
  | { type: 'paragraph'; text: string }
  | { type: 'unordered-list' | 'ordered-list'; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'code'; language: string; text: string }
  | { type: 'image'; alt: string; src: string }
  | { type: 'callout'; tone: 'tip' | 'warning' | 'info'; title: string; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] };

export type MarkdownDocument = { blocks: MarkdownBlock[]; headings: Heading[] };

export function slugifyHeading(value: string) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function cleanInline(value: string) {
  return value.replace(/<[^>]*>/g, (tag) => tag.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
}

export function parseMarkdown(source: string): MarkdownDocument {
  const lines = source.replace(/^---[\s\S]*?---\s*/, '').split(/\r?\n/);
  const blocks: MarkdownBlock[] = [];
  const headings: Heading[] = [];
  let index = 0;
  let headingCount = 0;

  const addHeading = (level: 2 | 3, raw: string) => {
    const text = raw.trim();
    const base = slugifyHeading(text) || `secao-${headingCount + 1}`;
    const id = headings.some((heading) => heading.id === base) ? `${base}-${headingCount + 1}` : base;
    headingCount += 1;
    headings.push({ id, text, level });
    blocks.push({ type: 'heading', level, text, id });
  };

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }
    const callout = line.match(/^:::(tip|warning|info)\s*(.*)$/i);
    if (callout) {
      const tone = callout[1]!.toLowerCase() as 'tip' | 'warning' | 'info';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && lines[index]?.trim() !== ':::') {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push({
        type: 'callout',
        tone,
        title: callout[2]?.trim() || (tone === 'tip' ? 'Dica' : tone === 'warning' ? 'Atenção' : 'Informação'),
        text: cleanInline(body.join(' ').trim()),
      });
      continue;
    }
    if (line.startsWith('```')) {
      const language = line.slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !lines[index]!.startsWith('```')) {
        code.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', language, text: code.join('\n') });
      continue;
    }
    const heading = line.match(/^(##|###)\s+(.+)$/);
    if (heading) {
      addHeading(heading[1] === '##' ? 2 : 3, heading[2]!);
      index += 1;
      continue;
    }
    const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (image) {
      blocks.push({ type: 'image', alt: cleanInline(image[1]!), src: image[2]! });
      index += 1;
      continue;
    }
    if (/^\|/.test(line) && lines[index + 1]?.includes('|')) {
      const split = (value: string) => value.split('|').slice(1, -1).map((cell) => cell.trim());
      const headers = split(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\|/.test(lines[index]!)) {
        rows.push(split(lines[index]!));
        index += 1;
      }
      blocks.push({ type: 'table', headers, rows });
      continue;
    }
    if (/^[-*]\s+/.test(line) || /^\d+\.\s+/.test(line)) {
      const ordered = /^\d+\./.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const match = (lines[index] ?? '').match(ordered ? /^\d+\.\s+(.+)$/ : /^[-*]\s+(.+)$/);
        if (!match) break;
        items.push(cleanInline(match[1]!));
        index += 1;
      }
      blocks.push({ type: ordered ? 'ordered-list' : 'unordered-list', items });
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (index < lines.length && lines[index]!.startsWith('>')) {
        quote.push(lines[index]!.replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: cleanInline(quote.join(' ')) });
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index]?.trim() &&
      !/^(##|###)\s+/.test(lines[index]!) &&
      !/^```/.test(lines[index]!) &&
      !/^:::(tip|warning|info)/i.test(lines[index]!) &&
      !/^[-*]\s+/.test(lines[index]!) &&
      !/^\d+\.\s+/.test(lines[index]!) &&
      !/^!\[/.test(lines[index]!) &&
      !/^>/.test(lines[index]!) &&
      !/^\|/.test(lines[index]!)
    ) {
      paragraph.push(lines[index]!);
      index += 1;
    }
    blocks.push({ type: 'paragraph', text: cleanInline(paragraph.join(' ')) });
  }
  return { blocks, headings };
}

export function parseFrontmatter(source: string) {
  const match = source.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
  const values: Record<string, string> = {};
  if (!match) return { values, body: source };
  for (const line of match[1]!.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }
  return { values, body: source.slice(match[0].length) };
}

export function parseList(value: string | undefined) {
  return (value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}
