import { addressSchema, type Address } from '@apmail/shared';

/** Includes text still being edited when taking a draft snapshot. */
export function recipientInputValue(value: Address[], input: string): Address[] {
  const seen = new Set(value.map((address) => address.address.toLowerCase()));
  return [
    ...value,
    ...input
      .split(/[,;\n]+/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => {
        const match = text.match(/^(.*?)\s*<([^>]+)>$/);
        return {
          name: match?.[1]?.replace(/^"|"$/g, '') ?? '',
          address: (match?.[2] ?? text).toLowerCase(),
        };
      })
      .filter((address) => {
        if (seen.has(address.address)) return false;
        seen.add(address.address);
        return true;
      }),
  ];
}

/** Incomplete editing belongs to the draft, never to the delivery envelope. */
export function draftRecipientValue(value: Address[], input: string) {
  const committed = value.filter((address) => addressSchema.safeParse(address).success);
  const unfinished = value
    .filter((address) => !addressSchema.safeParse(address).success)
    .map((address) => (address.name ? `${address.name} <${address.address}>` : address.address));
  const pending = recipientInputValue([], input);
  if (pending.some((address) => !addressSchema.safeParse(address).success)) unfinished.push(input);
  return {
    addresses: recipientInputValue(committed, '').concat(
      pending.filter(
        (address) =>
          addressSchema.safeParse(address).success &&
          !committed.some(
            (existing) => existing.address.toLowerCase() === address.address.toLowerCase(),
          ),
      ),
    ),
    input: unfinished.join('; '),
  };
}
