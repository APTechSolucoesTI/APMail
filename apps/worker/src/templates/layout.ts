export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function emailLayout(title: string, body: string, action?: { label: string; url: string }) {
  return `<!doctype html><html lang="pt-BR"><body style="margin:0;background:#F7F8FA;color:#111827;font:14px/20px Arial,sans-serif"><div style="max-width:560px;margin:24px auto;background:#FFFFFF;border:1px solid #E4E7EC;border-radius:12px;overflow:hidden"><div style="padding:24px;background:linear-gradient(135deg,#0D2B5E,#1A6B8A,#00C2CB);color:#FFFFFF;font-size:24px;font-weight:700">APMail</div><div style="padding:24px"><h1 style="font-size:24px;line-height:32px">${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p>${action ? `<p><a href="${escapeHtml(action.url)}" style="display:inline-block;padding:12px 20px;border-radius:8px;background:#137A98;color:#FFFFFF;font-weight:600;text-decoration:none">${escapeHtml(action.label)}</a></p><p>Se o botão não abrir, use o link: <a href="${escapeHtml(action.url)}">${escapeHtml(action.url)}</a></p>` : ''}<p style="color:#667085;font-size:12px">Mensagem automática do APMail.</p></div></div></body></html>`;
}
