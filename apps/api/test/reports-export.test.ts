import { it, expect } from 'vitest';
import { reportCsv, reportHtml, reportPdf } from '../src/modules/reports/export.js';
const document = {
  title: 'Reunião <segura>',
  context: 'Período e conta real',
  columns: ['Nome', 'Texto'],
  rows: [
    ['=HYPERLINK("bad")', '<script>alert(1)</script>'],
    [' @formula', 'A;B\nC'],
  ],
};
it('protects CSV formulas and preserves separators, accents and line breaks', () => {
  const csv = reportCsv(document);
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv).toContain('"\'=HYPERLINK(""bad"")"');
  expect(csv).toContain('"\' @formula"');
  expect(csv).toContain('"A;B\nC"');
});
it('escapes print content and creates a real PDF document', async () => {
  const html = reportHtml(document);
  expect(html).not.toContain('<script>');
  expect(html).toContain('&lt;script&gt;');
  const pdf = await reportPdf(document);
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  expect(pdf.length).toBeGreaterThan(1000);
});
