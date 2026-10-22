import DOMPurify from 'dompurify';

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
