import { expect, it } from 'vitest';
import { contactSchema, companySchema } from '../src/contacts.js';
const base = { name: 'Contato', emails: [{ email: 'principal@example.com' }] };
it('empresas são diretas, principais são únicos e apelido é opcional', () => {
  const result = contactSchema.parse({
    ...base,
    nickname: ' Meu cliente ',
    companies: [{ name: 'Empresa A', is_primary: true }, { name: 'Empresa B' }],
  });
  expect(result.nickname).toBe('Meu cliente');
  expect(result.companies).toHaveLength(2);
  expect(
    contactSchema.safeParse({
      ...base,
      companies: [
        { name: 'Empresa A', is_primary: true },
        { name: 'Empresa B', is_primary: true },
      ],
    }).success,
  ).toBe(false);
  expect(
    contactSchema.parse({ ...base, visibility: 'selected', mailbox_ids: [] }),
  ).not.toHaveProperty('visibility');
});
it('empresa independente normaliza CNPJ e admite cadastro manual sem documento', () => {
  expect(
    companySchema.parse({
      name: 'Empresa',
      cnpj: '12.345.678/0001-99',
      addresses: [{ cep: '01001000', street: 'Rua QA' }],
    }),
  ).toMatchObject({ cnpj: '12345678000199', addresses: [{ cep: '01001000', street: 'Rua QA' }] });
  expect(companySchema.parse({ name: 'Empresa manual' })).toMatchObject({
    cnpj: '',
    addresses: [],
  });
  expect(companySchema.safeParse({ name: 'Empresa', cnpj: '123' }).success).toBe(false);
});
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
