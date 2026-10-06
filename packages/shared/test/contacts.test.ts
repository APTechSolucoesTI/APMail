import { expect, it } from 'vitest';
import { contactSchema } from '../src/contacts.js';
const base = { name: 'Contato', emails: [{ email: 'principal@example.com' }] };
it('normaliza e-mails e detecta duplicações após a normalização', () => {
  expect(
    contactSchema.parse({ ...base, emails: [{ email: ' PRINCIPAL@EXAMPLE.COM ' }] }).emails[0]!
      .email,
  ).toBe('principal@example.com');
  expect(
    contactSchema.safeParse({
      ...base,
      emails: [...base.emails, { email: ' PRINCIPAL@EXAMPLE.COM ' }],
    }).success,
  ).toBe(false);
});
it('mantém compatibilidade com o telefone antigo e aceita vários canais identificados', () => {
  expect(contactSchema.parse({ ...base, phone: '1' }).phone).toBe('1');
  expect(
    contactSchema.parse({
      ...base,
      phones: [
        { number: '(11) 3333-2222', is_primary: true },
        { number: '11 99999-0000', label: 'Celular' },
      ],
    }).phones,
  ).toHaveLength(2);
  expect(
    contactSchema.safeParse({
      ...base,
      phones: [{ number: '(11) 3333-2222' }, { number: '1133332222' }],
    }).success,
  ).toBe(false);
});
it('recusa mais de um principal e exige empresa para o vínculo principal', () => {
  expect(
    contactSchema.safeParse({
      ...base,
      emails: [
        { email: 'a@example.com', is_primary: true },
        { email: 'b@example.com', is_primary: true },
      ],
    }).success,
  ).toBe(false);
  expect(
    contactSchema.safeParse({
      ...base,
      phones: [
        { number: '123', is_primary: true },
        { number: '456', is_primary: true },
      ],
    }).success,
  ).toBe(false);
  expect(
    contactSchema.safeParse({
      ...base,
      emails: [
        {
          email: 'a@example.com',
          links: [{ address: { city: 'São Paulo' }, is_primary_company: true }],
        },
      ],
    }).success,
  ).toBe(false);
  expect(
    contactSchema.safeParse({
      ...base,
      emails: [
        {
          email: 'a@example.com',
          links: [{ company: { name: 'Empresa A' }, is_primary_company: true }],
        },
        {
          email: 'b@example.com',
          links: [{ company: { name: 'Empresa B' }, is_primary_company: true }],
        },
      ],
    }).success,
  ).toBe(false);
});
