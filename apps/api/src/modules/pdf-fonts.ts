import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

type FontStyle = { bold?: boolean; italic?: boolean };
export type PdfFontRun = { text: string; font: string };
const winAnsi =
  /^[\s\u0020-\u00ff\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013\u2014\u2018-\u201e\u2020-\u2022\u2026\u2030\u2039\u203a\u20ac\u2122]*$/u;
export const usesStandardPdfFont = (value: string) => winAnsi.test(value);
const buffers = new Map<string, Buffer>();
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** PDFKit exposes its embedded fontkit face internally; use it only to validate glyph coverage. */
type FontDocument = PDFKit.PDFDocument & {
  _font: { font?: { hasGlyphForCodePoint(code: number): boolean } };
};

export function pdfFontRuns(doc: PDFKit.PDFDocument) {
  const registered = new Set<string>();
  const windows = process.env.WINDIR ? join(process.env.WINDIR, 'Fonts') : 'C:/Windows/Fonts';
  const noto = process.env.APMAIL_PDF_FONT_DIR || '/usr/share/fonts/noto';
  const choose = (paths: { path: string; family?: string }[], alias: string) => {
    if (registered.has(alias)) return alias;
    const file = paths.find((candidate) => existsSync(candidate.path));
    if (!file) return null;
    let buffer = buffers.get(file.path);
    if (!buffer) {
      buffer = readFileSync(file.path);
      buffers.set(file.path, buffer);
    }
    doc.registerFont(alias, buffer, file.family);
    registered.add(alias);
    return alias;
  };
  return (value: string, style: FontStyle = {}): PdfFontRun[] => {
    const suffix = style.bold
      ? style.italic
        ? 'BoldItalic'
        : 'Bold'
      : style.italic
        ? 'Italic'
        : 'Regular';
    const standard = style.bold
      ? style.italic
        ? 'Helvetica-BoldOblique'
        : 'Helvetica-Bold'
      : style.italic
        ? 'Helvetica-Oblique'
        : 'Helvetica';
    if (usesStandardPdfFont(value)) return [{ text: value, font: standard }];
    const result: PdfFontRun[] = [];
    for (const { segment } of segmenter.segment(value)) {
      let font: string | null = usesStandardPdfFont(segment) ? standard : null;
      if (!font) {
        const unicode = () =>
          choose(
            [
              { path: join(noto, `NotoSans-${suffix}.ttf`) },
              {
                path: join(
                  windows,
                  style.bold
                    ? style.italic
                      ? 'segoeuiz.ttf'
                      : 'segoeuib.ttf'
                    : style.italic
                      ? 'segoeuii.ttf'
                      : 'segoeui.ttf',
                ),
              },
            ],
            'unicode-' + suffix,
          );
        const cjk = () =>
          choose(
            [
              {
                path: join(noto, `NotoSansCJK-${style.bold ? 'Bold' : 'Regular'}.ttc`),
                family: `NotoSansCJKjp-${style.bold ? 'Bold' : 'Regular'}`,
              },
              { path: join(windows, 'msgothic.ttc'), family: 'MS-Gothic' },
            ],
            'cjk-' + suffix,
          );
        const emoji = () =>
          choose(
            [
              { path: fileURLToPath(new URL('../../assets/fonts/NotoEmoji.ttf', import.meta.url)) },
              { path: join(noto, 'NotoEmoji.ttf') },
            ],
            'emoji',
          );
        const candidates = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(segment)
          ? [emoji, unicode, cjk]
          : [unicode, cjk, emoji];
        for (const candidate of candidates) {
          const alias = candidate();
          if (!alias) continue;
          doc.font(alias);
          const face = (doc as FontDocument)._font.font;
          if (
            face &&
            [...segment].every(
              (character) =>
                [0x200d, 0xfe0e, 0xfe0f].includes(character.codePointAt(0)!) ||
                face.hasGlyphForCodePoint(character.codePointAt(0)!),
            )
          ) {
            font = alias;
            break;
          }
        }
      }
      // Never silently replace a character with unrelated WinAnsi bytes or a missing-glyph box.
      if (!font)
        throw new Error(
          'Não foi encontrada uma fonte PDF compatível com o conteúdo. Confira as fontes instaladas no servidor.',
        );
      const previous = result.at(-1);
      if (previous?.font === font) previous.text += segment;
      else result.push({ text: segment, font });
    }
    return result;
  };
}
