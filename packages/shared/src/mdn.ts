import { z } from 'zod';
import { emailSchema } from './schemas/common.js';
export const messageIdSchema = z
  .string()
  .max(998)
  .regex(/^<[^<>\s]+@[^<>\s]+>$/)
  .refine((value) =>
    [...value].every((char) => char.charCodeAt(0) >= 33 && char.charCodeAt(0) <= 126),
  );
export const mdnRequestSchema = z.object({
  to: z.string().trim().max(254).pipe(z.email()),
  recipient: z.string().trim().max(254).pipe(z.email()),
  original_message_id: messageIdSchema,
  return_path_matches: z.boolean(),
});
export type MdnRequest = z.infer<typeof mdnRequestSchema>;
export type MdnReceipt = {
  recipient: string;
  originalMessageId: string;
  disposition: 'displayed' | 'deleted' | 'dispatched' | 'processed';
};
/** RFC mailbox matching preserves local-part case. */
export function protocolAddressEqual(a: string, b: string) {
  const split = (v: string) => {
    const i = v.lastIndexOf('@');
    return [v.slice(0, i), v.slice(i + 1).toLowerCase()];
  };
  const left = split(a),
    right = split(b);
  return left[0] === right[0] && left[1] === right[1];
}
export function parseMdnFields(content: string): MdnReceipt | null {
  if (
    content.length > 32768 ||
    [...content].some((char) => {
      const code = char.charCodeAt(0);
      return ![9, 10, 13].includes(code) && (code < 32 || code > 126);
    })
  )
    return null;
  const fields = new Map<string, string>();
  const unfolded = content.replace(/\r?\n[ \t]+/g, ' ');
  for (const line of unfolded.trim().split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9-]+):[ \t]*(.*)$/);
    if (!match) return null;
    const key = match[1]!.toLowerCase();
    if (fields.has(key)) return null;
    fields.set(key, match[2]!.trim());
  }
  // Strip RFC comments only in CFWS-bearing fields; never inside a Message-ID.
  const stripComments = (value: string) => {
    for (let depth = 0; depth < 10 && /\([^()]*\)/.test(value); depth++)
      value = value.replace(/\([^()]*\)/g, ' ');
    return value.trim();
  };
  const typedAddress = (value: string) =>
    stripComments(value).match(/^rfc822\s*;\s*([^\s<>]+)$/i)?.[1];
  const recipient = typedAddress(fields.get('final-recipient') ?? '');
  const originalMessageId = fields.get('original-message-id') ?? '';
  const disposition = stripComments(fields.get('disposition') ?? '')
    .match(
      /^(manual-action|automatic-action)\s*\/\s*MDN-sent-(manually|automatically)\s*;\s*(displayed|deleted|dispatched|processed)\s*$/i,
    )?.[3]
    ?.toLowerCase() as MdnReceipt['disposition'] | undefined;
  if (
    !recipient ||
    !emailSchema.safeParse(recipient).success ||
    !messageIdSchema.safeParse(originalMessageId).success ||
    !disposition
  )
    return null;
  return { recipient: recipient.toLowerCase(), originalMessageId, disposition };
}
