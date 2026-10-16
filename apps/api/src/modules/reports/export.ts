import PDFDocument from 'pdfkit';
import { escapeHtml } from '@apmail/db';
export type ReportDocument = {
  title: string;
  context: string;
  columns: string[];
  rows: string[][];
  notes?: string[];
  sections?: { title: string; text: string }[];
  landscape?: boolean;
};
export function reportCsv(document: ReportDocument): string {
  const cell = (value: string) =>
    '"' + (/^[\s]*[=+@-]/.test(value) ? "'" + value : value).replaceAll('"', '""') + '"';
  return (
    '\uFEFF' +
    [document.columns, ...document.rows].map((row) => row.map(cell).join(';')).join('\r\n')
  );
}
export function reportHtml(document: ReportDocument): string {
  return `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>${escapeHtml(document.title)}</title><style>@page{size:A4 ${document.landscape ? 'landscape' : 'portrait'};margin:15mm}body{font:12px/1.5 Arial,sans-serif;color:#111827;max-width:1100px;margin:24px auto}header{border-bottom:3px solid #1686a7;padding-bottom:16px}h1{font-size:22px;margin:8px 0}h2{font-size:16px;margin-top:24px}.brand{font-size:18px;color:#155e75;font-weight:bold}.muted{color:#667085}table{width:100%;border-collapse:collapse;margin:18px 0}thead{display:table-header-group}th,td{text-align:left;vertical-align:top;border-bottom:1px solid #e4e7ec;padding:8px;overflow-wrap:anywhere}th{background:#e9f6f9;color:#155e75}tr{break-inside:avoid}p{white-space:pre-wrap}footer{border-top:1px solid #e4e7ec;margin-top:24px;font-size:11px;color:#667085}@media print{body{margin:0;max-width:none}a{color:inherit}}</style><header><div class="brand">APMail · Relatórios</div><h1>${escapeHtml(document.title)}</h1><p class="muted">${escapeHtml(document.context)}</p></header><table><thead><tr>${document.columns.map((column) => '<th>' + escapeHtml(column) + '</th>').join('')}</tr></thead><tbody>${document.rows.length ? document.rows.map((row) => '<tr>' + row.map((cell) => '<td>' + escapeHtml(cell) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + document.columns.length + '">Nenhum registro neste período.</td></tr>'}</tbody></table>${(document.sections ?? []).map((section) => '<section><h2>' + escapeHtml(section.title) + '</h2><p>' + escapeHtml(section.text) + '</p></section>').join('')}<footer>${(document.notes ?? []).map((note) => '<p>' + escapeHtml(note) + '</p>').join('')}<p>Gerado pelo APMail em ${escapeHtml(new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))}.</p></footer></html>`;
}
export async function reportPdf(document: ReportDocument): Promise<Buffer> {
  const doc = new PDFDocument({
    size: 'A4',
    layout: document.landscape ? 'landscape' : 'portrait',
    margin: 40,
    bufferPages: true,
    info: { Title: document.title, Author: 'APMail' },
  });
  const chunks: Buffer[] = [],
    finished = new Promise<Buffer>((resolve, reject) => {
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });
  const width = doc.page.width - 80;
  const header = () => {
    doc
      .fillColor('#155e75')
      .font('Helvetica-Bold')
      .fontSize(14)
      .text('APMail  /  Relatórios', 40, 32);
    doc.fillColor('#111827').fontSize(18).text(document.title, 40, 58, { width });
    doc
      .fillColor('#667085')
      .font('Helvetica')
      .fontSize(9)
      .text(document.context, 40, doc.y + 7, { width });
    const y = doc.y + 12;
    doc
      .moveTo(40, y)
      .lineTo(doc.page.width - 40, y)
      .lineWidth(1)
      .strokeColor('#1686a7')
      .stroke();
    doc.y = y + 14;
  };
  header();
  const weights = document.columns.map((_, i) => (i === 0 ? 2.5 : 1.5)),
    weight = weights.reduce((a, b) => a + b, 0),
    widths = weights.map((v) => (width * v) / weight);
  const lines = (text: string, available: number): string[] => {
    const result: string[] = [];
    for (const paragraph of text.split(/\r?\n/)) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (doc.widthOfString((line ? line + ' ' : '') + word) <= available)
          line += (line ? ' ' : '') + word;
        else {
          if (line) result.push(line);
          line = '';
          for (const character of word) {
            if (line && doc.widthOfString(line + character) > available) {
              result.push(line);
              line = '';
            }
            line += character;
          }
        }
      }
      result.push(line);
    }
    return result;
  };
  const row = (cells: string[], isHeader = false) => {
    doc.font(isHeader ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
    const wrapped = cells.map((cell, i) => lines(cell || '—', widths[i]! - 14));
    let offset = 0;
    const count = Math.max(...wrapped.map((value) => value.length));
    while (offset < count) {
      if (doc.y + 28 > doc.page.height - 55) {
        doc.addPage();
        header();
        if (!isHeader) row(document.columns, true);
      }
      const available = Math.max(1, Math.floor((doc.page.height - 55 - doc.y - 14) / 12));
      const taken = Math.min(count - offset, available),
        height = Math.max(28, taken * 12 + 14),
        y = doc.y;
      if (isHeader) doc.rect(40, y, width, height).fill('#e9f6f9');
      let x = 40;
      for (let i = 0; i < cells.length; i++) {
        doc
          .fillColor(isHeader ? '#155e75' : '#111827')
          .font(isHeader ? 'Helvetica-Bold' : 'Helvetica')
          .fontSize(9);
        for (const [index, line] of wrapped[i]!.slice(offset, offset + taken).entries())
          doc.text(line, x + 7, y + 7 + index * 12, { width: widths[i]! - 14, lineBreak: false });
        x += widths[i]!;
      }
      doc
        .moveTo(40, y + height)
        .lineTo(40 + width, y + height)
        .lineWidth(0.5)
        .strokeColor('#e4e7ec')
        .stroke();
      doc.y = y + height;
      offset += taken;
      if (offset < count) {
        doc.addPage();
        header();
        if (!isHeader) row(document.columns, true);
      }
    }
  };
  if (document.rows.length) {
    row(document.columns, true);
    for (const cells of document.rows) row(cells);
  } else if (!document.sections?.length)
    doc
      .font('Helvetica')
      .fontSize(10)
      .fillColor('#667085')
      .text('Nenhum registro neste período.', 40);
  const paragraph = (text: string, size: number, color: string, bold = false) => {
    doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(size);
    const wrapped = lines(text, width),
      step = size * 1.4;
    doc.y += 8;
    for (const line of wrapped) {
      if (doc.y + step > doc.page.height - 55) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      doc
        .font(bold ? 'Helvetica-Bold' : 'Helvetica')
        .fontSize(size)
        .fillColor(color)
        .text(line, 40, y, { width, lineBreak: false });
      doc.y = y + step;
    }
  };
  for (const section of document.sections ?? []) {
    if (doc.y > doc.page.height - 110) {
      doc.addPage();
      header();
    }
    paragraph(section.title, 11, '#155e75', true);
    paragraph(section.text, 10, '#111827');
  }
  for (const note of document.notes ?? []) paragraph(note, 8, '#667085');
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    doc
      .font('Helvetica')
      .fontSize(8)
      .fillColor('#667085')
      .text(`APMail · ${i + 1} / ${range.count}`, 40, doc.page.height - 30, {
        width,
        align: 'right',
        lineBreak: false,
        height: 12,
      });
  }
  doc.end();
  return finished;
}
