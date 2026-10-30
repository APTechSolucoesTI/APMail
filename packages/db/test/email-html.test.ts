import { it, expect } from 'vitest';
import { sanitizeEmailHtml } from '../src/sanitize.js';

it('preserves Outlook shorthand highlights and stylesheet formatting without enabling remote resources or scripts', () => {
  const html = sanitizeEmailHtml(
    `<html><head><style>.highlight { background: yellow; color: red; font-weight: bold } .bad {background-image:url(https://tracking.invalid/pixel)}</style></head><body><p class="highlight">Mês e Soluções</p><span style="background:#ffff00">Salários</span><span class="bad" onclick="alert(1)">Seguro</span><script>alert(1)</script><img src="cid:outlook-image"></body></html>`,
  );
  expect(html).toMatch(/<p[^>]*style="[^"]*background(?:-color)?:\s*yellow/);
  expect(html).toMatch(/<p[^>]*style="[^"]*font-weight:\s*bold/);
  expect(html).toContain('Mês e Soluções');
  expect(html).toContain('background:#ffff00');
  expect(html).toContain('data-apmail-cid="outlook-image"');
  expect(html).not.toMatch(/<style|<script|onclick|background-image|tracking\.invalid/);
  expect(sanitizeEmailHtml('<span style="mso-highlight:yellow">Marcado</span>')).toContain(
    'background-color:yellow',
  );
  expect(sanitizeEmailHtml('<font face="Calibri" size="3">Fonte</font>')).toContain(
    'face="Calibri"',
  );
  expect(
    sanitizeEmailHtml(
      '<div style="background:image-set(&quot;https://tracking.invalid/pixel&quot; 1x)">x</div>',
    ),
  ).not.toContain('tracking.invalid');
});
