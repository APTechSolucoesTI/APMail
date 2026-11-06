import type { Editor } from '@tiptap/react';
import type { Mark } from '@tiptap/pm/model';
import { COMPOSITION_FONTS } from '@apmail/shared';

/** Materialize inherited inline typography before ProseMirror discards unsupported wrappers. */
export function preserveEditorTypography(html: string): string {
  const template = document.createElement('template');
  template.innerHTML = html;
  const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  while (walker.nextNode()) texts.push(walker.currentNode as Text);
  for (const text of texts) {
    if (!text.textContent?.trim() || text.parentElement?.closest('script, style')) continue;
    let fontFamily = '',
      fontSize = '';
    for (let parent = text.parentElement; parent; parent = parent.parentElement) {
      const family =
        parent.style.fontFamily ||
        (parent.tagName === 'FONT' ? (parent.getAttribute('face') ?? '') : '');
      const size = parent.style.fontSize;
      if (!fontFamily && family && !['inherit', 'unset'].includes(family)) fontFamily = family;
      if (!fontSize && size && !['inherit', 'unset'].includes(size)) fontSize = size;
      if (fontFamily && fontSize) break;
    }
    if (!fontFamily && !fontSize) continue;
    if (
      text.parentElement?.tagName === 'SPAN' &&
      text.parentElement.style.fontFamily === fontFamily &&
      text.parentElement.style.fontSize === fontSize
    )
      continue;
    const span = document.createElement('span');
    if (fontFamily) span.style.fontFamily = fontFamily;
    if (fontSize) span.style.fontSize = fontSize;
    text.replaceWith(span);
    span.append(text);
  }
  return template.innerHTML;
}

const primaryFamily = (value: string) =>
  value.split(',')[0]!.replace(/["']/g, '').trim().toLowerCase();
export function editorFontFamily(value: string) {
  return COMPOSITION_FONTS.find((font) => primaryFamily(font) === primaryFamily(value)) ?? value;
}
export function editorFontSize(value: string) {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(px|pt)$/i);
  return match ? `${Number(match[1])}${match[2]!.toLowerCase()}` : value;
}
export const editorSizeLabel = (value: string) => value.replace(/px$/, '').replace(/pt$/, ' pt');

/** Read the current selection, including stored typing marks and mixed-format ranges. */
export function editorTypography(editor: Editor) {
  const root = getComputedStyle(editor.view.dom);
  const fallback = {
    fontFamily: editorFontFamily(root.fontFamily || 'Arial, sans-serif'),
    fontSize: editorFontSize(root.fontSize || '14px'),
  };
  const read = (marks: readonly Mark[]) => {
    const attrs = marks.find((mark) => mark.type.name === 'textStyle')?.attrs;
    return {
      fontFamily: editorFontFamily(
        typeof attrs?.fontFamily === 'string' && attrs.fontFamily
          ? attrs.fontFamily
          : fallback.fontFamily,
      ),
      fontSize: editorFontSize(
        typeof attrs?.fontSize === 'string' && attrs.fontSize ? attrs.fontSize : fallback.fontSize,
      ),
    };
  };
  const { from, to, $from, empty } = editor.state.selection;
  const selected: ReturnType<typeof read>[] = [];
  if (empty) selected.push(read(editor.state.storedMarks ?? $from.marks()));
  else
    editor.state.doc.nodesBetween(from, to, (node) => {
      if (node.isText) selected.push(read(node.marks));
    });
  const first = selected[0] ?? fallback;
  return {
    fontFamily: selected.some((value) => value.fontFamily !== first.fontFamily)
      ? ''
      : first.fontFamily,
    fontSize: selected.some((value) => value.fontSize !== first.fontSize) ? '' : first.fontSize,
  };
}
