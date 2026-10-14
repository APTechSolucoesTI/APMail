import { emailSchema } from './schemas/common.js';
import type { Address } from './threading.js';

/** Same canonicalization as the directory; never removes dots or subaddresses. */
export function normalizeContactEmail(value: string): string | null {
  const parsed = emailSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
export type ContactIdentity = { id: string; name: string; scope: 'personal' | 'tenant' };
export type ContactResolution = Record<string, ContactIdentity>;
export function resolveAddress(address: Address, contacts: ContactResolution) {
  const contact = contacts[normalizeContactEmail(address.address) ?? ''] ?? null;
  return { ...address, name: contact?.name || address.name || address.address, contact };
}
export function uniqueAddresses(addresses: Address[]): Address[] {
  const result = new Map<string, Address>();
  for (const item of addresses) {
    const address = normalizeContactEmail(item.address);
    if (address && !result.has(address)) result.set(address, { ...item, address });
  }
  return [...result.values()];
}
