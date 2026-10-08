import { expect, it } from 'vitest';
import { contactSchema, phoneSchema } from '../src/contacts.js';
import { parseContactCsv, mapContactCsv, parseContactVcf } from '../src/contact-import.js';
const base = { name: 'Henrique Rufino', emails: [{ email: 'principal@example.com' }] };
it('normaliza e-mails e rejeita duplicatas após normalização', () => {
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
  for (const email of ['abc', 'a@', 'a@b', 'a b@example.com', 'a@example..com'])
    expect(contactSchema.safeParse({ ...base, emails: [{ email }] }).success).toBe(false);
});
it('valida número realista e normaliza país/DDD', () => {
  expect(phoneSchema.parse('(11) 3333-2222')).toBe('+551133332222');
  expect(phoneSchema.parse('11 99999-0000')).toBe('+5511999990000');
  expect(phoneSchema.parse('+1 202 555 0123')).toBe('+12025550123');
  for (const number of [
    '1',
    '99999-0000',
    '(00) 99999-0000',
    'abcdefgh',
    'Ligue 11 99999-0000',
    '11111111111111111111',
  ])
    expect(phoneSchema.safeParse(number).success).toBe(false);
});
it('permite contato apenas telefônico, endereços opcionais e principal único', () => {
  expect(
    contactSchema.safeParse({ name: base.name, phones: [{ number: '11 99999-0000' }] }).success,
  ).toBe(true);
  expect(contactSchema.safeParse({ name: base.name }).success).toBe(false);
  expect(
    contactSchema.safeParse({
      ...base,
      phones: [{ number: '11 99999-0000' }, { number: '+5511999990000' }],
    }).success,
  ).toBe(false);
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
    contactSchema.parse({
      ...base,
      company: ' Acme ',
      addresses: [{ street: 'Rua A' }, { type: 'work', street: 'Rua B' }],
    }),
  ).toMatchObject({ company: 'Acme', addresses: [{ type: 'home' }, { type: 'work' }] });
});
it('CSV Outlook aceita BOM, ponto e vírgula, aspas e notas multilinha', () => {
  const csv = parseContactCsv(
    '\uFEFFFirst Name;Last Name;Company;E-mail Address;Mobile Phone;Notes\r\nHenrique;Rufino;"Acme; Ltda";henrique@example.com;(11) 99999-0000;"Linha 1\nLinha ""2"""',
  );
  const rows = mapContactCsv(csv, csv.mapping);
  expect(rows[0]!.errors).toEqual([]);
  expect(rows[0]!.data).toMatchObject({
    name: 'Henrique Rufino',
    company: 'Acme; Ltda',
    notes: 'Linha 1\nLinha "2"',
    phones: [{ number: '+5511999990000' }],
  });
  expect(() => parseContactCsv('Nome,E-mail\n"ab,c')).toThrow();
  expect(() => mapContactCsv(csv, { '0': 'company', '1': 'company' })).toThrow();
});
it('CSV reporta canais inválidos por linha sem registrá-los', () => {
  const csv = parseContactCsv(
    'Full Name,E-mail Address,Mobile Phone\nPessoa A,email-invalido,123\nPessoa B,b@example.com,',
  );
  const rows = mapContactCsv(csv, csv.mapping);
  expect(rows[0]!.errors.length).toBeGreaterThan(0);
  expect(rows[1]!.errors).toEqual([]);
});
it('VCF desdobra linhas, suporta canais/endereço e ignora foto remota', () => {
  const rows = parseContactVcf(
    'BEGIN:VCARD\r\nVERSION:4.0\r\nFN:Henrique Rufino\r\nN:Rufino;Henrique;;;\r\nORG:Acme;Suporte\r\nTITLE:Analista\r\nEMAIL;PREF=1:henrique@example.com\r\nTEL;TYPE=cell;PREF=1:tel:+5511999990000\r\nADR;TYPE=work:;;Rua A;São Paulo;SP;01001000;Brasil\r\nNOTE:Texto longo\r\n  continua\\nlinha 2\r\nPHOTO:https://example.com/photo.jpg\r\nEND:VCARD',
  );
  expect(rows[0]!.errors).toEqual([]);
  expect(rows[0]!.data).toMatchObject({
    company: 'Acme',
    department: 'Suporte',
    notes: 'Texto longo continua\nlinha 2',
    addresses: [{ street: 'Rua A', type: 'work' }],
  });
  expect(rows[0]!.data).not.toHaveProperty('photo');
  expect(rows[0]!.warnings).toEqual(['Propriedades não importadas: PHOTO']);
  expect(() => parseContactVcf('BEGIN:VCARD\nVERSION:2.1\nEND:VCARD')).toThrow();
});
