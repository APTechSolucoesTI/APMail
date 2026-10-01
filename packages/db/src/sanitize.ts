import sanitizeHtml from 'sanitize-html';
import { convert } from 'html-to-text';
export const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const styles: Record<string, RegExp[]> = Object.fromEntries(
  [
    'color',
    'background-color',
    'font-family',
    'font-size',
    'font-weight',
    'font-style',
    'text-align',
    'text-decoration',
    'line-height',
    'margin',
    'margin-top',
    'margin-bottom',
    'margin-left',
    'margin-right',
    'padding',
    'padding-top',
    'padding-bottom',
    'padding-left',
    'padding-right',
    'border',
    'border-width',
    'border-style',
    'border-color',
    'border-collapse',
    'width',
    'height',
    'max-width',
    'vertical-align',
  ].map((key) => [key, [/^(?!.*(?:url\s*\(|expression|javascript|@import|\\)).{1,200}$/i]]),
);
export function sanitizeEmailHtml(html: string, text = '', blockRemoteImages = true): string {
  const source =
    html ||
    escapeHtml(text)
      .replace(/\bhttps?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)
      .replace(/\r?\n/g, '<br>');
  return sanitizeHtml(source, {
    allowedTags: [
      ...sanitizeHtml.defaults.allowedTags,
      'img',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'td',
      'th',
      'colgroup',
      'col',
      'center',
      'font',
      'span',
      'div',
      'hr',
      'u',
      's',
      'sup',
      'sub',
    ],
    allowedAttributes: {
      '*': [
        'title',
        'width',
        'height',
        'align',
        'valign',
        'colspan',
        'rowspan',
        'cellpadding',
        'cellspacing',
        'border',
        'bgcolor',
        'color',
        'style',
      ],
      a: ['href', 'target', 'rel'],
      img: ['src', 'alt', 'data-apmail-src', 'data-apmail-cid'],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: ['data'] },
    allowProtocolRelative: false,
    allowedStyles: { '*': styles },
    transformTags: {
      a: (_, attribs) => ({
        tagName: 'a',
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
      }),
      img: (_, attribs) => {
        const attrs = { ...attribs },
          src = attrs.src ?? '';
        delete attrs.src;
        if (/^https?:\/\//i.test(src)) {
          if (blockRemoteImages) attrs['data-apmail-src'] = src;
          else attrs.src = src;
        } else if (/^cid:/i.test(src))
          attrs['data-apmail-cid'] = src.slice(4).replace(/^<|>$/g, '');
        else if (
          /^data:image\/(?:png|gif|jpeg|webp);base64,/i.test(src) &&
          Buffer.byteLength(src) <= 200 * 1024
        )
          attrs.src = src;
        if (attrs['data-apmail-src'] && !/^https?:\/\//i.test(attrs['data-apmail-src']))
          delete attrs['data-apmail-src'];
        return { tagName: 'img', attribs: attrs };
      },
    },
  });
}
export const htmlToText = (html: string): string =>
  convert(html, { wordwrap: false, selectors: [{ selector: 'img', format: 'skip' }] });
export function messageSnippet(text: string): string {
  const withoutQuote =
    text
      .split(/\r?\n/)
      .filter((line) => !/^\s*>/.test(line))
      .join('\n')
      .split(/(?:\n|^)(?:Em .+ escreveu:|On .+ wrote:)/i)[0] ?? '';
  return withoutQuote.replace(/\s+/g, ' ').trim().slice(0, 200);
}
