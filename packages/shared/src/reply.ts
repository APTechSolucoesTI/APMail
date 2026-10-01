import { formatInTimeZone } from 'date-fns-tz';
import type { Address } from './threading.js';
export type ReplyKind = 'reply' | 'reply_all' | 'forward';
export type ReplyMessage = {
  from_name: string;
  from_address: string;
  reply_to: Address[];
  to_addresses: Address[];
  cc_addresses: Address[];
  subject: string;
  body_html: string;
  message_at: string | Date;
};
const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function replySubject(subject: string, kind: ReplyKind): string {
  const prefix = kind === 'forward' ? 'Enc' : 'Re';
  const existing = kind === 'forward' ? /^(enc|fw|fwd)\s*:/i : /^(re|res)\s*:/i;
  return existing.test(subject.trim()) ? subject.trim() : `${prefix}: ${subject.trim()}`;
}
export function replyRecipients(message: ReplyMessage, kind: ReplyKind, ourAddresses: string[]) {
  if (kind === 'forward') return { to_addresses: [], cc_addresses: [] };
  const seen = new Set(ourAddresses.map((a) => a.toLowerCase()));
  const unique = (addresses: Address[]) =>
    addresses
      .filter((a) => {
        const key = a.address.toLowerCase();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((a) => ({ ...a, address: a.address.toLowerCase() }));
  const to_addresses = unique(
    message.reply_to.length
      ? message.reply_to
      : [{ name: message.from_name, address: message.from_address }],
  );
  if (kind === 'reply_all') to_addresses.push(...unique(message.to_addresses));
  return { to_addresses, cc_addresses: kind === 'reply_all' ? unique(message.cc_addresses) : [] };
}
export function quoteHtml(message: ReplyMessage, kind: ReplyKind, timezone: string): string {
  const date = formatInTimeZone(new Date(message.message_at), timezone, 'dd/MM/yyyy HH:mm');
  const from = `${escape(message.from_name)} &lt;${escape(message.from_address)}&gt;`;
  const header =
    kind === 'forward'
      ? `---------- Mensagem encaminhada ----------<br>De: ${from}<br>Data: ${date}<br>Assunto: ${escape(message.subject)}<br>Para: ${message.to_addresses.map((a) => escape(a.address)).join(', ')}`
      : `Em ${date}, ${from} escreveu:`;
  return `<blockquote data-apmail-quote><p>${header}</p>${message.body_html}</blockquote>`;
}
