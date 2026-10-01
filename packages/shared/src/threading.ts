export function normalizeSubject(subject: string): string {
  return subject
    .trim()
    .replace(/^\s*((re|res|fw|fwd|enc|tr|aw|wg|rv)\s*(\[\d+\])?\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');
}
export type Address = { name: string; address: string };
export type ParticipantsMessage = {
  from_address: string;
  to_addresses: Address[];
  cc_addresses: Address[];
};
export function externalParticipants(
  message: ParticipantsMessage,
  ourAddresses: string[],
): string[] {
  const ours = new Set(ourAddresses.map((address) => address.toLowerCase()));
  return [
    ...new Set(
      [
        message.from_address,
        ...message.to_addresses.map((a) => a.address),
        ...message.cc_addresses.map((a) => a.address),
      ]
        .map((a) => a.toLowerCase())
        .filter((a) => a && !ours.has(a)),
    ),
  ];
}
export function isAutomated(from: string, headers: Record<string, string>): boolean {
  const h = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value.toLowerCase()]),
  );
  return (
    (!!h['auto-submitted'] && h['auto-submitted'] !== 'no') ||
    ['bulk', 'list', 'junk'].includes(h.precedence ?? '') ||
    'list-unsubscribe' in h ||
    'list-id' in h ||
    /^(noreply|no-reply|nao-responda|naoresponda|mailer-daemon|postmaster)/i.test(from)
  );
}
