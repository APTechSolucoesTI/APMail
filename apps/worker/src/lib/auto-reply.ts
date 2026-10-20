import type { ParsedMail } from 'mailparser';
import { isAutomated, normalizeRuleEmail, emailSchema } from '@apmail/shared';

/** Personal/group responders use the validated return path, never an arbitrary Reply-To. */
export function readAutoReplyTarget(parsed: ParsedMail, own: string[]): string | null {
  const headers = Object.fromEntries(
    [...parsed.headers].map(([key, value]) => [key, String(value)]),
  );
  const sender = parsed.from?.value;
  if (sender?.length !== 1 || !sender[0]?.address || isAutomated(sender[0].address, headers))
    return null;
  const lines = (key: string) => parsed.headerLines.filter((h) => h.key === key);
  if (lines('list-id').length || lines('list-unsubscribe').length) return null;
  if (
    lines('from').length !== 1 ||
    lines('return-path').length !== 1 ||
    lines('auto-submitted').length > 1
  )
    return null;
  if (parsed.headers.has('x-auto-response-suppress') || parsed.headers.has('newsgroups'))
    return null;
  const type = parsed.headers.get('content-type') as { value?: string } | undefined;
  if (
    ['multipart/report', 'message/delivery-status', 'message/disposition-notification'].includes(
      type?.value?.toLowerCase() ?? '',
    )
  )
    return null;
  const path = lines('return-path')[0]!
    .line.replace(/\r?\n[ \t]+/g, ' ')
    .replace(/^[^:]+:\s*/, '')
    .trim();
  const match = /^<([^<>\s]+@[^<>\s]+)>$/.exec(path);
  if (!match || match[1]!.length > 254) return null;
  const target = normalizeRuleEmail(match[1]!);
  if (!emailSchema.safeParse(target).success) return null;
  if (isAutomated(target, {}) || own.some((address) => normalizeRuleEmail(address) === target))
    return null;
  const recipients = [parsed.to, parsed.cc]
    .flatMap((v) => (v ? (Array.isArray(v) ? v : [v]) : []))
    .flatMap((v) => v.value.map((a) => normalizeRuleEmail(a.address ?? '')));
  if (!own.some((a) => recipients.includes(normalizeRuleEmail(a)))) return null;
  return target;
}
