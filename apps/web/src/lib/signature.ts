import DOMPurify from 'dompurify';

// O preview usa o arquivo da aplicação; o HTML enviado conserva a referência CID.
export function signaturePreview(html: string): string {
  const document = new DOMParser().parseFromString(DOMPurify.sanitize(html), 'text/html');
  for (const image of document.querySelectorAll('img[data-apmail-signature-image]')) {
    const id = image.getAttribute('data-apmail-signature-image');
    if (id && /^[0-9a-f-]{36}$/i.test(id))
      image.setAttribute('src', '/api/signatures/images/' + id);
  }
  return DOMPurify.sanitize(document.body.innerHTML);
}
