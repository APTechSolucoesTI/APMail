import PDFDocument from 'pdfkit';
import sanitizeHtml from 'sanitize-html';
import { pdfFontRuns, usesStandardPdfFont, type PdfFontRun } from './pdf-fonts.js';

export type ConversationPdfMessage = {
  id: string;
  message_id_header: string;
  subject: string;
  from_name: string;
  from_address: string;
  to_addresses: unknown;
  cc_addresses: unknown;
  bcc_addresses: unknown;
  message_at: Date | string;
  body_text: string;
  body_html: string | null;
  attachments: { id: string; filename: string }[];
  images?: Record<string, { data: Buffer; width: number; height: number }>;
};
export type ConversationPdfDocument = {
  subject: string;
  timezone?: string;
  messages: ConversationPdfMessage[];
};
type HtmlNode = { tag: string; attrs: Record<string, string>; children: HtmlNode[]; text?: string };
type Run = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; link?: string };
const decode = (value: string) =>
  value.replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[0-9a-f]+);/gi, (entity, name: string) => {
    const normalized = name.toLowerCase();
    if (normalized.startsWith('#')) {
      const point = Number.parseInt(
        normalized.slice(normalized[1] === 'x' ? 2 : 1),
        normalized[1] === 'x' ? 16 : 10,
      );
      return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : entity;
    }
    return (
      (
        { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0' } as Record<
          string,
          string
        >
      )[normalized] ?? entity
    );
  });

function addresses(value: unknown): string {
  if (!Array.isArray(value)) return '—';
  return (
    value
      .flatMap((entry: unknown) => {
        if (
          !entry ||
          typeof entry !== 'object' ||
          !('address' in entry) ||
          typeof entry.address !== 'string'
        )
          return [];
        return [
          'name' in entry && typeof entry.name === 'string' && entry.name
            ? `${entry.name} <${entry.address}>`
            : entry.address,
        ];
      })
      .join('; ') || '—'
  );
}

/** Tokenize normalized, allowlisted HTML only; never fetch mail images or external resources. */
function bodyTree(html: string): HtmlNode {
  const clean = sanitizeHtml(html, {
    allowedTags: [...sanitizeHtml.defaults.allowedTags, 'img', 'u', 's'],
    allowedAttributes: {
      a: ['href'],
      img: ['alt', 'src', 'data-apmail-src', 'data-apmail-cid', 'width', 'height'],
      '*': ['colspan', 'rowspan', 'style'],
    },
    allowedSchemes: ['https', 'http', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['http', 'https', 'cid', 'data'] },
    allowProtocolRelative: false,
    allowedStyles: {
      '*': {
        'font-weight': [/^(?:bold|[1-9]00)$/],
        'font-style': [/^italic$/],
        'text-decoration': [/^underline$/],
      },
    },
  });
  const root: HtmlNode = { tag: 'root', attrs: {}, children: [] },
    stack = [root];
  for (const token of clean.match(/<[^>]*>|[^<]+/g) ?? []) {
    const current = stack[stack.length - 1]!;
    if (token.startsWith('</')) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (token.startsWith('<')) {
      const tag = /^<([a-z0-9]+)/i.exec(token)?.[1]?.toLowerCase();
      if (!tag) continue;
      const attrs = Object.fromEntries(
        [...token.matchAll(/([\w-]+)="([^"]*)"/g)].map((match) => [match[1]!, decode(match[2]!)]),
      );
      const node: HtmlNode = { tag, attrs, children: [] };
      current.children.push(node);
      if (!['img', 'br', 'hr', 'wbr', 'col'].includes(tag)) stack.push(node);
    } else current.children.push({ tag: '#text', attrs: {}, children: [], text: decode(token) });
  }
  return root;
}

function inline(node: HtmlNode, inherited: Omit<Run, 'text'> = {}, pre = false): Run[] {
  if (node.text !== undefined)
    return [{ ...inherited, text: pre ? node.text : node.text.replace(/\s+/g, ' ') }];
  if (node.tag === 'br') return [{ ...inherited, text: '\n' }];
  if (node.tag === 'img')
    return [{ ...inherited, text: `[Imagem${node.attrs.alt ? ': ' + node.attrs.alt : ''}]` }];
  const style = node.attrs.style ?? '';
  const format = {
    ...inherited,
    bold:
      inherited.bold ||
      ['b', 'strong', 'th'].includes(node.tag) ||
      /font-weight:\s*(bold|[6-9]00)/.test(style),
    italic:
      inherited.italic || ['i', 'em'].includes(node.tag) || /font-style:\s*italic/.test(style),
    underline:
      inherited.underline || node.tag === 'u' || /text-decoration:\s*underline/.test(style),
    ...(node.tag === 'a' && node.attrs.href ? { link: node.attrs.href } : {}),
  };
  return node.children.flatMap((child) => inline(child, format, pre));
}

export async function conversationPdf(conversation: ConversationPdfDocument): Promise<Buffer> {
  const timezone = conversation.timezone ?? 'America/Sao_Paulo';
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: 74, bottom: 58, left: 42, right: 42 },
    bufferPages: true,
    info: { Title: conversation.subject || 'Conversa', Author: 'APMail' },
  });
  const chunks: Buffer[] = [];
  const result = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
  const width = doc.page.width - 84;
  const fontRuns = pdfFontRuns(doc);
  const space = (height: number) => {
    if (doc.y + height > doc.page.height - 58) doc.addPage();
  };
  const text = (
    value: string,
    options: { size?: number; bold?: boolean; color?: string; indent?: number } = {},
  ) => {
    rich(
      [{ text: value, bold: options.bold }],
      options.indent ?? 0,
      options.size ?? 10,
      options.color,
    );
  };
  const rich = (runs: Run[], indent = 0, size = 10, color?: string) => {
    const lines: Run[][] = [[]];
    for (const run of runs) {
      for (const [index, part] of run.text.split('\n').entries()) {
        if (index > 0) lines.push([]);
        if (part) lines.at(-1)!.push({ ...run, text: part });
      }
    }
    for (const unshaped of lines) {
      const line = unshaped.flatMap((run) =>
        fontRuns(run.text, run).map((font) => ({ ...run, ...font })),
      );
      if (!line.some((run) => run.text.trim())) {
        if (lines.length > 1) doc.y += 13;
        continue;
      }
      for (const [index, run] of line.entries()) {
        doc
          .font(run.font)
          .fontSize(size)
          .fillColor(color ?? (run.link ? '#155e75' : '#111827'));
        const options = {
          width: width - indent,
          lineGap: 3,
          continued: index < line.length - 1,
          underline: run.underline || !!run.link,
          link: run.link ?? null,
          oblique: run.font.startsWith('cjk-') && run.italic ? 12 : 0,
        };
        if (index === 0) doc.text(run.text, 42 + indent, doc.y, options);
        else doc.text(run.text, options);
      }
    }
  };
  const unicodeTable = (rows: HtmlNode[], indent: number, columns: number) => {
    const columnWidth = (width - indent) / columns;
    for (const row of rows) {
      const cells = row.children
        .filter((cell) => ['td', 'th'].includes(cell.tag))
        .map((cell) => {
          const cellWidth =
            columnWidth * Math.max(1, Math.min(columns, Number(cell.attrs.colspan) || 1));
          const lines: PdfFontRun[][] = [[]];
          let used = 0;
          for (const run of fontRuns(
            inline(cell)
              .map((part) => part.text)
              .join(''),
            { bold: cell.tag === 'th' },
          )) {
            doc.font(run.font).fontSize(9);
            for (const character of run.text) {
              const advance = doc.widthOfString(character);
              if (character === '\n' || (used > 0 && used + advance > cellWidth - 12)) {
                lines.push([]);
                used = 0;
              }
              if (character === '\n') continue;
              const previous = lines.at(-1)!.at(-1);
              if (previous?.font === run.font) previous.text += character;
              else lines.at(-1)!.push({ text: character, font: run.font });
              used += advance;
            }
          }
          return { width: cellWidth, lines, header: cell.tag === 'th' };
        });
      let offset = 0;
      const total = Math.max(1, ...cells.map((cell) => cell.lines.length));
      while (offset < total) {
        space(30);
        const count = Math.min(
          total - offset,
          Math.max(1, Math.floor((doc.page.height - 58 - doc.y - 12) / 15)),
        );
        const top = doc.y,
          height = count * 15 + 12;
        let left = 42 + indent;
        for (const cell of cells) {
          doc.rect(left, top, cell.width, height).lineWidth(0.5).strokeColor('#e4e7ec');
          if (cell.header) doc.fillAndStroke('#e9f6f9', '#e4e7ec');
          else doc.stroke();
          for (const [index, line] of cell.lines.slice(offset, offset + count).entries()) {
            let x = left + 6;
            for (const run of line) {
              doc
                .font(run.font)
                .fontSize(9)
                .fillColor(cell.header ? '#155e75' : '#111827')
                .text(run.text, x, top + 6 + index * 15, { lineBreak: false, height: 15 });
              x += doc.widthOfString(run.text);
            }
          }
          left += cell.width;
        }
        doc.y = top + height;
        offset += count;
      }
    }
  };
  const blocks = new Set([
    'root',
    'p',
    'div',
    'section',
    'article',
    'header',
    'footer',
    'blockquote',
    'ul',
    'ol',
    'li',
    'pre',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'table',
    'hr',
  ]);
  let images: NonNullable<ConversationPdfMessage['images']> = {};
  const containsImage = (node: HtmlNode): boolean =>
    node.tag === 'img' || node.children.some(containsImage);
  const render = (node: HtmlNode, indent = 0) => {
    if (node.tag === 'img') {
      const source = node.attrs['data-apmail-cid']
        ? 'cid:' + node.attrs['data-apmail-cid']
        : (node.attrs['data-apmail-src'] ?? node.attrs.src ?? '');
      const image = images[source];
      if (!image) {
        text(`[Imagem indisponível${node.attrs.alt ? ': ' + node.attrs.alt : ''}]`, {
          size: 8,
          color: '#667085',
          indent,
        });
        return;
      }
      const requested = Number.parseFloat(node.attrs.width ?? '');
      const imageWidth = Math.min(width - indent, (requested > 0 ? requested : image.width) * 0.75);
      const scale = Math.min(1, 450 / ((imageWidth * image.height) / image.width));
      const w = imageWidth * scale,
        h = (w * image.height) / image.width;
      space(h + 8);
      const top = doc.y;
      doc.image(image.data, 42 + indent, top, { width: w, height: h });
      doc.y = top + h + 6;
      return;
    }
    if (node.tag === 'hr') {
      doc.y += 5;
      space(14);
      doc
        .moveTo(42 + indent, doc.y)
        .lineTo(42 + width, doc.y)
        .strokeColor('#e4e7ec')
        .lineWidth(0.5)
        .stroke();
      doc.y += 9;
      return;
    }
    if (node.tag === 'table') {
      if (containsImage(node)) {
        for (const child of node.children) render(child, indent);
        return;
      }
      const rows: HtmlNode[] = [];
      const collect = (child: HtmlNode) => {
        if (child.tag === 'tr') rows.push(child);
        else child.children.forEach(collect);
      };
      node.children.forEach(collect);
      if (rows.length) {
        const columnCount = Math.max(
          ...rows.map((row) =>
            row.children
              .filter((cell) => ['td', 'th'].includes(cell.tag))
              .reduce(
                (sum, cell) => sum + Math.max(1, Math.min(20, Number(cell.attrs.colspan) || 1)),
                0,
              ),
          ),
        );
        if (
          columnCount &&
          columnCount <= 12 &&
          !usesStandardPdfFont(
            inline(node)
              .map((run) => run.text)
              .join(''),
          )
        ) {
          unicodeTable(rows, indent, columnCount);
        } else if (columnCount && columnCount <= 12) {
          space(35);
          doc.font('Helvetica').fontSize(9).fillColor('#111827');
          doc.table({
            position: { x: 42 + indent, y: doc.y },
            maxWidth: width - indent,
            columnStyles: Array.from({ length: columnCount }, () => (width - indent) / columnCount),
            defaultStyle: { padding: 6, border: 0.5, borderColor: '#e4e7ec' },
            data: rows.map((row) =>
              row.children
                .filter((cell) => ['td', 'th'].includes(cell.tag))
                .map((cell) => ({
                  text: inline(cell)
                    .map((run) => run.text)
                    .join(''),
                  colSpan: Math.max(1, Math.min(20, Number(cell.attrs.colspan) || 1)),
                  rowSpan: Math.max(1, Math.min(100, Number(cell.attrs.rowspan) || 1)),
                  font: { src: cell.tag === 'th' ? 'Helvetica-Bold' : 'Helvetica', size: 9 },
                  ...(cell.tag === 'th'
                    ? { backgroundColor: '#e9f6f9', textColor: '#155e75' }
                    : {}),
                })),
            ),
          });
        } else for (const row of rows) rich(inline(row), indent);
        doc.x = 42;
        doc.y += 8;
      }
      return;
    }
    const nextIndent = indent + (node.tag === 'blockquote' ? 14 : node.tag === 'li' ? 10 : 0);
    let pending: Run[] = [];
    const flush = () => {
      if (pending.length) rich(pending, nextIndent, /^h[1-6]$/.test(node.tag) ? 12 : 10);
      pending = [];
    };
    if (node.tag === 'li') pending.push({ text: '• ' });
    for (const child of node.children) {
      if (blocks.has(child.tag) || containsImage(child)) {
        flush();
        render(child, nextIndent);
      } else
        pending.push(
          ...inline(child, /^h[1-6]$/.test(node.tag) ? { bold: true } : {}, node.tag === 'pre'),
        );
    }
    flush();
    if (node.tag !== 'root' && !['ul', 'ol'].includes(node.tag)) doc.y += node.tag === 'li' ? 3 : 6;
  };

  text(conversation.subject || '(Sem assunto)', { size: 18, bold: true });
  doc.y += 6;
  text(`${conversation.messages.length} mensagem(ns) · Ordem cronológica · Fuso: ${timezone}`, {
    size: 9,
    color: '#667085',
  });
  doc.y += 18;
  for (const [index, message] of conversation.messages.entries()) {
    images = message.images ?? {};
    space(130);
    text(`Mensagem ${index + 1} de ${conversation.messages.length}`, {
      size: 11,
      bold: true,
      color: '#155e75',
    });
    doc.y += 5;
    text(
      `De: ${message.from_name ? message.from_name + ' <' + message.from_address + '>' : message.from_address}`,
    );
    text(`Para: ${addresses(message.to_addresses)}`);
    text(`CC: ${addresses(message.cc_addresses)}`);
    text(`CCO (BCC): ${addresses(message.bcc_addresses)}`);
    text(`Assunto: ${message.subject || '(Sem assunto)'}`);
    text(
      `Data: ${new Date(message.message_at).toLocaleString('pt-BR', { timeZone: timezone })} (${timezone})`,
    );
    text(`ID da mensagem: ${message.message_id_header || message.id}`, {
      size: 8,
      color: '#667085',
    });
    doc.y += 10;
    if (message.body_html?.trim()) render(bodyTree(message.body_html));
    else text(message.body_text || '(Mensagem sem conteúdo)');
    if (message.attachments.length) {
      doc.y += 9;
      space(32);
      text('Anexos', { size: 10, bold: true });
      for (const attachment of message.attachments)
        text(`${attachment.filename || '(Sem nome)'} · ID: ${attachment.id}`, {
          size: 9,
          color: '#667085',
        });
    }
    if (index === conversation.messages.length - 1) continue;
    doc.y += 10;
    space(18);
    doc
      .moveTo(42, doc.y)
      .lineTo(42 + width, doc.y)
      .strokeColor('#e4e7ec')
      .lineWidth(0.5)
      .stroke();
    doc.y += 12;
  }
  const pages = doc.bufferedPageRange();
  for (let page = pages.start; page < pages.start + pages.count; page++) {
    doc.switchToPage(page);
    // Same envelope, proportions and brand colors as public/favicon.svg.
    doc.save().roundedRect(42, 28, 26, 26, 5).fill('#0D2B5E');
    doc.roundedRect(47, 35, 16, 12, 2).lineWidth(1.4).strokeColor('#47C4DD').stroke();
    doc.moveTo(47, 36).lineTo(55, 42).lineTo(63, 36).stroke().restore();
    doc
      .font('Helvetica-Bold')
      .fontSize(13)
      .fillColor('#0D2B5E')
      .text('APMail', 76, 34, { lineBreak: false });
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#667085')
      .text('Conversa de e-mail', 42, 59, { lineBreak: false });
    doc
      .moveTo(42, 68)
      .lineTo(42 + width, 68)
      .lineWidth(0.7)
      .strokeColor('#1686a7')
      .stroke();
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#667085')
      .text(`Gerado pelo APMail · ${page + 1} / ${pages.count}`, 42, doc.page.height - 32, {
        width,
        align: 'right',
        lineBreak: false,
        height: 12,
      });
  }
  doc.end();
  return result;
}
