import sanitizeHtml from 'sanitize-html';
import { convert } from 'html-to-text';
import juice from 'juice';
export const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
const styles: Record<string, RegExp[]> = Object.fromEntries(
  [
    'color',
    'background-color',
    'background',
    'font',
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
    'min-width',
    'vertical-align',
    'white-space',
    'text-indent',
    'letter-spacing',
    'list-style-type',
    'border-top',
    'border-right',
    'border-bottom',
    'border-left',
    'border-spacing',
  ].map((key) => [key, [/^(?!.*(?:url\s*\(|expression|javascript|@import|\\)).{1,200}$/i]]),
);
// Shorthand backgrounds are needed for Outlook highlighting, but image-set(),
// cross-fade() and other resource loaders must never bypass image consent.
styles.background = [
  /^(?:[a-z]+|#[0-9a-f]{3,8}|(?:rgb|rgba|hsl|hsla)\([-+\d.%\s,/]+\))(?:\s*!important)?$/i,
];
export function sanitizeEmailHtml(
  html: string,
  text = '',
  blockRemoteImages = true,
  transformImage?: (attributes: Record<string, string>) => Record<string, string>,
): string {
  let source =
    html ||
    escapeHtml(text)
      .replace(/\bhttps?:\/\/[^\s<]+/g, (url) => `<a href="${url}">${url}</a>`)
      .replace(/\r?\n/g, '<br>');
  if (/<style\b/i.test(source)) {
    // Inline only embedded CSS. Unlike juiceResources/juiceFile, juice() never
    // retrieves linked stylesheets, images, fonts or any other remote resources.
    try {
      source = juice(source, {
        applyStyleTags: true,
        removeStyleTags: true,
        preserveMediaQueries: false,
        preserveFontFaces: false,
        preserveKeyFrames: false,
        preservePseudos: false,
      });
    } catch {
      // Malformed legacy CSS must not discard the message; inline styles still
      // go through the same allowlist below, even when a stylesheet cannot inline.
    }
  }
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
        'dir',
        'lang',
        'data-apmail-signature',
        'data-apmail-quote',
      ],
      a: ['href', 'target', 'rel'],
      font: ['face', 'size'],
      img: [
        'src',
        'alt',
        'data-apmail-src',
        'data-apmail-cid',
        'data-apmail-upload',
        'data-apmail-signature-image',
      ],
    },
    allowedSchemes: ['http', 'https', 'mailto', 'tel'],
    allowedSchemesByTag: { img: blockRemoteImages ? ['data'] : ['https', 'http', 'data', 'cid'] },
    allowProtocolRelative: false,
    allowedStyles: { '*': styles },
    transformTags: {
      '*': (tagName, attribs) => ({
        tagName,
        attribs: attribs.style
          ? {
              ...attribs,
              style: attribs.style.replace(
                /(^|;)\s*mso-highlight\s*:\s*([^;]+)/gi,
                '$1background-color:$2',
              ),
            }
          : attribs,
      }),
      body: (_, attribs) => ({ tagName: 'div', attribs }),
      a: (_, attribs) => ({
        tagName: 'a',
        attribs: { ...attribs, target: '_blank', rel: 'noopener noreferrer nofollow' },
      }),
      img: (_, attribs) => {
        const attrs = { ...(transformImage ? transformImage(attribs) : attribs) },
          src =
            attrs.src ??
            (!blockRemoteImages && attrs['data-apmail-cid']
              ? 'cid:' + attrs['data-apmail-cid']
              : !blockRemoteImages
                ? (attrs['data-apmail-src'] ?? '')
                : '');
        delete attrs.src;
        if (/^https?:\/\//i.test(src)) {
          if (blockRemoteImages) attrs['data-apmail-src'] = src;
          else attrs.src = src;
        } else if (/^cid:/i.test(src)) {
          if (blockRemoteImages) attrs['data-apmail-cid'] = src.slice(4).replace(/^<|>$/g, '');
          else attrs.src = src;
        } else if (
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
