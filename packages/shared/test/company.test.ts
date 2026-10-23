import { expect, it } from 'vitest';
import { tenantSchema } from '../src/schemas/auth.js';

it('normaliza CNPJ numérico e alfanumérico e rejeita dígitos inválidos', () => {
  for (const [value, normalized] of [
    ['11.222.333/0001-81', '11222333000181'],
    ['00.000.000/e08g-12', '00000000E08G12'],
  ]) {
    const company = tenantSchema.parse({
      name: 'Empresa QA',
      slug: 'empresa-qa',
      company_details: { cnpj: value },
    });
    expect(company).toHaveProperty('company_details.cnpj', normalized);
  }
  for (const cnpj of ['00000000000000', '11222333000182', '1122233300018', '11@222333000181'])
    expect(
      tenantSchema.safeParse({ name: 'Empresa QA', slug: 'empresa-qa', company_details: { cnpj } })
        .success,
    ).toBe(false);
});

it('valida dados opcionais e mantém compatibilidade com empresas existentes', () => {
  const base = { name: 'Empresa QA', slug: 'empresa-qa' };
  expect(tenantSchema.safeParse(base).success).toBe(true);
  for (const company_details of [
    { email: 'invalido' },
    { website: 'javascript:alert(1)' },
    { state: 'ZZ' },
    { postal_code: '123' },
    { phone: 'abc' },
  ])
    expect(tenantSchema.safeParse({ ...base, company_details }).success).toBe(false);
  expect(
    tenantSchema.parse({
      ...base,
      company_details: { email: ' CONTATO@EXAMPLE.COM ', postal_code: '01001-000' },
    }),
  ).toMatchObject({ company_details: { email: 'contato@example.com', postal_code: '01001000' } });
});
