import { BlockList, isIP } from 'node:net';
import { domainToASCII } from 'node:url';

const privateV4 = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  privateV4.addSubnet(address, prefix, 'ipv4');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const reservedV6 = new BlockList();
reservedV6.addSubnet('2001:db8::', 32, 'ipv6');

/** A single SMTP EHLO argument: public hostname or correctly bracketed IP literal. */
export function normalizeSmtpHelloName(input: string): string | null {
  // Never permit whitespace/control characters or SMTP command injection.
  if (
    !input ||
    /\s/.test(input) ||
    Array.from(input).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return null;
  const raw = input.replace(/^\[(?:IPv6:)?(.+)\]$/i, '$1');
  const family = isIP(raw);
  if (family === 4) return privateV4.check(raw, 'ipv4') ? null : `[${raw}]`;
  if (family === 6)
    return globalV6.check(raw, 'ipv6') && !reservedV6.check(raw, 'ipv6')
      ? `[IPv6:${raw.toLowerCase()}]`
      : null;
  if (['[', ']', ':', '/', '@', '?', '#', '\\'].some((character) => input.includes(character)))
    return null;
  const name = domainToASCII(input.replace(/\.$/, '')).toLowerCase();
  if (!name || name.length > 253) return null;
  const labels = name.split('.');
  if (
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
  )
    return null;
  if (
    /^\d+$/.test(labels.at(-1)!) ||
    /(?:^|\.)(?:localhost|local|localdomain|internal|lan|home|invalid|test)$/.test(name)
  )
    return null;
  return name;
}

export function smtpHelloName(env: {
  APP_URL: string;
  SMTP_EHLO_NAME?: string;
  NODE_ENV?: string;
}): string {
  if (env.SMTP_EHLO_NAME) {
    const configured = normalizeSmtpHelloName(env.SMTP_EHLO_NAME);
    if (!configured)
      throw new Error(
        'SMTP_EHLO_NAME deve ser um domínio público ou IP público válido, sem protocolo ou porta.',
      );
    return configured;
  }
  const automatic = normalizeSmtpHelloName(new URL(env.APP_URL).hostname);
  if (automatic) return automatic;
  // Offline fixtures retain a stable identity without exposing a container name or loopback.
  if (env.NODE_ENV === 'development' || env.NODE_ENV === 'test') return 'apmail.test';
  throw new Error(
    'Configure SMTP_EHLO_NAME com o domínio público do APMail; APP_URL não possui uma identificação SMTP pública válida.',
  );
}
