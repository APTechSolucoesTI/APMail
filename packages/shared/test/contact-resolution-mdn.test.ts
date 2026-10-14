import { it, expect } from 'vitest';
import {
  normalizeContactEmail,
  resolveAddress,
  uniqueAddresses,
  parseMdnFields,
  protocolAddressEqual,
  outboxSchema,
  preferencesSchema,
} from '../src/index.js';
const contact = { id: 'person', name: 'João da Silva', scope: 'tenant' as const };
it('normaliza a agenda sem equivalência indevida por pontos ou + e usa somente vínculos cadastrados', () => {
  expect(normalizeContactEmail(' JOAO@Empresa.com ')).toBe('joao@empresa.com');
  const contacts = { 'joao@empresa.com': contact, 'financeiro@empresa.com': contact };
  expect(resolveAddress({ address: 'JOAO@EMPRESA.COM', name: 'SMTP name' }, contacts).name).toBe(
    contact.name,
  );
  expect(
    resolveAddress({ address: 'financeiro@empresa.com', name: '' }, contacts).contact?.id,
  ).toBe('person');
  for (const address of ['jo.ao@empresa.com', 'joao+tag@empresa.com'])
    expect(resolveAddress({ address, name: 'Original' }, contacts).name).toBe('Original');
  expect(
    uniqueAddresses([
      { name: 'João', address: 'JOAO@EMPRESA.COM' },
      { name: '', address: 'joao@empresa.com' },
      { name: '', address: 'joao+tag@empresa.com' },
    ]),
  ).toHaveLength(2);
});
const report =
  'Reporting-UA: client; mail\r\nFinal-Recipient: rfc822; joao@empresa.com\r\nOriginal-Message-ID: <original@example.com>\r\nDisposition: manual-action/MDN-sent-manually; displayed\r\n';
it('MDN exige Message-ID, destinatário e disposition válido, não confunde delivery/processed com displayed', () => {
  expect(parseMdnFields(report)?.disposition).toBe('displayed');
  expect(parseMdnFields(report.replace('displayed', 'processed'))?.disposition).toBe('processed');
  for (const invalid of [
    report.replace('displayed', 'delivered'),
    report + 'Final-Recipient: rfc822; evil@example.com\r\n',
    report.replace('<original@example.com>', 'invalid'),
    report.replace('displayed', 'displayed/error'),
    report.replace('joao@empresa.com', 'invalid'),
  ])
    expect(parseMdnFields(invalid)).toBeNull();
  expect(protocolAddressEqual('User@EXAMPLE.com', 'User@example.com')).toBe(true);
  expect(protocolAddressEqual('User@example.com', 'user@example.com')).toBe(false);
});
it('solicitação manual é independente da preferência global e rascunhos antigos permanecem sem solicitação', () => {
  const preference = preferencesSchema.parse({ request_read_receipt: true });
  expect(preference.request_read_receipt).toBe(true);
  const base = { mailbox_id: '123e4567-e89b-42d3-a456-426614174000' };
  expect(outboxSchema.parse(base).request_read_receipt).toBe(false);
  expect(outboxSchema.parse({ ...base, request_read_receipt: true }).request_read_receipt).toBe(
    true,
  );
  expect(outboxSchema.parse({ ...base, request_read_receipt: false }).request_read_receipt).toBe(
    false,
  );
  expect(preference.request_read_receipt).toBe(true);
});
