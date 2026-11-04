import DOMPurify from 'dompurify';
import type { Attachment } from './mail';

export const composerCid = (value: string) => value.trim().replace(/^<|>$/g, '').toLowerCase();
const canEmbed = (file: Attachment) =>
  !!file.content_id && /^image\/(png|jpeg|gif|webp)$/.test(file.content_type);

/** A clone inherits only images referenced by this message's own body. */
export function cloneComposerBody(message: {
  body_html: string | null;
  body_text: string;
  attachments: Attachment[];
}) {
  // Template content is inert. Resolve original CID sources before sanitizing the clone.
  const template = document.createElement('template');
  if (!message.body_html) {
    const text = document.createElement('pre');
    text.textContent = message.body_text;
    template.content.append(text);
    return { html: template.innerHTML, files: [] as Attachment[] };
  }
  template.innerHTML = message.body_html;
  const candidates = message.attachments.filter(canEmbed);
  const files = new Map<string, Attachment>();
  const attachmentReference =
    /(?:\bcid:|\/api\/(?:attachments|uploads|public\/signature-images|signatures\/images)\/)/i;
  for (const element of template.content.querySelectorAll('*')) {
    if (element.tagName === 'IMG') {
      const src = element.getAttribute('src') ?? '';
      const signature = element.getAttribute('data-apmail-signature-image');
      const upload = element.getAttribute('data-apmail-upload');
      const cid =
        element.getAttribute('data-apmail-cid') ??
        src.match(/^cid:(.+)$/i)?.[1] ??
        (signature ? `signature-${signature}@apmail.local` : null) ??
        (upload ? `${upload}@apmail.local` : null);
      if (cid) {
        const file = candidates.find((a) => composerCid(a.content_id!) === composerCid(cid));
        if (!file) {
          element.remove();
          continue;
        }
        files.set(file.id, file);
        element.setAttribute('data-apmail-cid', file.content_id!);
        for (const attr of [
          'src',
          'srcset',
          'data-apmail-src',
          'data-apmail-upload',
          'data-apmail-signature-image',
        ])
          element.removeAttribute(attr);
      } else {
        const remote = element.getAttribute('data-apmail-src');
        if (!src && remote && /^https?:\/\//i.test(remote)) {
          element.setAttribute('src', remote);
          element.removeAttribute('data-apmail-src');
        }
      }
    }
    for (const attribute of [...element.attributes]) {
      if (attribute.name === 'data-apmail-cid' || !attachmentReference.test(attribute.value))
        continue;
      if (['src', 'srcset', 'poster', 'data'].includes(attribute.name)) element.remove();
      else element.removeAttribute(attribute.name);
    }
  }
  const html = DOMPurify.sanitize(template.innerHTML);
  template.innerHTML = html;
  const retainedCids = new Set(
    [...template.content.querySelectorAll('img[data-apmail-cid]')].map((image) =>
      image.getAttribute('data-apmail-cid'),
    ),
  );
  return {
    html,
    files: [...files.values()].filter((file) => retainedCids.has(file.content_id ?? null)),
  };
}

/** Replace the editable signature snapshot, never the user's message or quoted history. */
export function replaceComposerSignature(
  html: string,
  signature: { id: string; body_html: string } | null,
): string {
  const doc = new DOMParser().parseFromString(DOMPurify.sanitize(html), 'text/html');
  for (const node of doc.querySelectorAll('[data-apmail-signature]')) {
    // A quoted message can contain its own signature, which belongs to the original message.
    if (!node.closest('blockquote')) node.remove();
  }
  if (signature) {
    const block = doc.createElement('div');
    block.setAttribute('data-apmail-signature', signature.id);
    block.innerHTML = DOMPurify.sanitize(signature.body_html) || '<p></p>';
    doc.body.append(block);
  }
  return doc.body.innerHTML;
}
