import type { Kysely, Selectable } from 'kysely';
import type { DB } from '../types.js';
import { sanitizeEmailHtml } from '../sanitize.js';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
export const signatureCid = (id: string) => `signature-${id}@apmail.local`;
type SignatureContext = {
  tenant_id: string;
  created_by: string;
  mailbox_id: string;
  signature_id?: string | null;
  body_html: string;
};

// O HTML salvo é um snapshot. Inclui a assinatura selecionada quando um cliente
// envia apenas o ID e converte imagens próprias em referências MIME, sem buscar URLs.
export async function prepareSignature(
  db: Kysely<DB>,
  row: SignatureContext,
  inheritedCids: string[] = [],
) {
  let html = row.body_html;
  if (row.signature_id)
    html = html.replace(
      new RegExp(
        `<div\\b[^>]*data-apmail-signature\\s*=\\s*["']${row.signature_id}["'][^>]*>\\s*</div>`,
        'gi',
      ),
      '',
    );
  if (
    row.signature_id &&
    !new RegExp(`data-apmail-signature=["']${row.signature_id}["']`, 'i').test(html)
  ) {
    const signature = await db
      .selectFrom('signatures')
      .select(['body_html', 'mailbox_id'])
      .where('id', '=', row.signature_id)
      .where('tenant_id', '=', row.tenant_id)
      .where('user_id', '=', row.created_by)
      .where('deleted_at', 'is', null)
      .executeTakeFirst();
    if (!signature || (signature.mailbox_id && signature.mailbox_id !== row.mailbox_id))
      throw new Error('A assinatura selecionada não está disponível.');
    const block = `<div data-apmail-signature="${row.signature_id}">${signature.body_html}</div>`;
    const quote = html.search(/<blockquote\b[^>]*data-apmail-quote/i);
    html = quote < 0 ? html + block : html.slice(0, quote) + block + html.slice(quote);
  }
  const ids = new Set<string>();
  html = sanitizeEmailHtml(html, '', false, (attrs) => {
    const id =
      attrs.src?.match(new RegExp(`^cid:signature-(${uuid})@apmail\\.local$`, 'i'))?.[1] ??
      attrs.src?.match(
        new RegExp(`^https?://[^/]+/api/public/signature-images/(${uuid})(?:\\?.*)?$`, 'i'),
      )?.[1];
    if (!id) return attrs;
    const normalized = id.toLowerCase();
    ids.add(normalized);
    return {
      ...attrs,
      src: 'cid:' + signatureCid(normalized),
      'data-apmail-signature-image': normalized,
    };
  });
  const images: Selectable<DB['signature_images']>[] = [];
  for (const id of ids) {
    if (inheritedCids.includes(signatureCid(id))) continue;
    const image = await db
      .selectFrom('signature_images')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', row.tenant_id)
      .where('user_id', '=', row.created_by)
      .executeTakeFirst();
    if (!image)
      throw new Error('Uma imagem da assinatura não está disponível. Anexe a imagem novamente.');
    images.push(image);
  }
  return { bodyHtml: html, images };
}
