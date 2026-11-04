import DOMPurify from 'dompurify';

/** Copies message content while detaching all original attachment/CID resources. */
export function cloneComposerBody(message: {
  body_html: string | null;
  body_text: string;
}): string {
  const doc = new DOMParser().parseFromString(
    DOMPurify.sanitize(message.body_html ?? ''),
    'text/html',
  );
  if (!message.body_html) {
    const text = doc.createElement('pre');
    text.textContent = message.body_text;
    doc.body.replaceChildren(text);
    return doc.body.innerHTML;
  }
  const attachmentReference =
    /(?:\bcid:|\/api\/(?:attachments|uploads|public\/signature-images|signatures\/images)\/)/i;
  for (const element of doc.body.querySelectorAll('*')) {
    if (
      element.hasAttribute('data-apmail-upload') ||
      element.hasAttribute('data-apmail-signature-image')
    ) {
      element.remove();
      continue;
    }
    for (const attribute of [...element.attributes]) {
      if (!attachmentReference.test(attribute.value)) continue;
      if (['src', 'srcset', 'poster', 'data'].includes(attribute.name)) element.remove();
      else element.removeAttribute(attribute.name);
    }
  }
  return doc.body.innerHTML;
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
