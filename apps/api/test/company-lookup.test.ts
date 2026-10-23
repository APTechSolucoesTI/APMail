import { expect, it } from 'vitest';
import { lookupCompany } from '../src/lib/company-lookup.js';

const cnpj = '11222333000181';
it('maps validated registration data without leaking provider extras', async () => {
  const result = await lookupCompany(
    cnpj,
    async () =>
      new Response(
        JSON.stringify({
          cnpj,
          razao_social: 'Empresa QA',
          nome_fantasia: 'QA',
          cep: '01001-000',
          uf: 'SP',
          municipio: 'São Paulo',
          tipo_logradouro: 'RUA',
          logradouro: 'Teste',
          numero: '10',
          ddd_telefone_1: '1133332222',
          email: null,
          qsa: [{ nome_socio: 'Private extra' }],
        }),
      ),
  );
  expect(result).toEqual({
    cnpj,
    legal_name: 'Empresa QA',
    trade_name: 'QA',
    postal_code: '01001000',
    state: 'SP',
    city: 'São Paulo',
    street: 'RUA Teste',
    number: '10',
    phone: '+551133332222',
    country: 'Brasil',
  });
});
it('handles unavailable, missing, malformed and mismatched provider responses', async () => {
  await expect(
    lookupCompany(cnpj, async () => new Response('{}', { status: 404 })),
  ).rejects.toMatchObject({ statusCode: 404, code: 'company_not_found' });
  for (const response of [
    new Response('{}', { status: 503 }),
    new Response('not-json'),
    new Response(JSON.stringify({ cnpj: '19131243000197', razao_social: 'Wrong' })),
  ])
    await expect(lookupCompany(cnpj, async () => response)).rejects.toMatchObject({
      statusCode: 503,
      code: 'company_lookup_unavailable',
    });
  await expect(
    lookupCompany(cnpj, async () => {
      throw new Error('network');
    }),
  ).rejects.toMatchObject({ statusCode: 503 });
});
it('recovers registration data from the upstream when BrasilAPI is unavailable', async () => {
  const result = await lookupCompany(cnpj, async (url) =>
    String(url).startsWith('https://brasilapi.com.br/')
      ? new Response('Forbidden', { status: 403 })
      : new Response(
          JSON.stringify({
            cnpj,
            razao_social: 'Empresa recuperada',
            descricao_tipo_de_logradouro: 'AVENIDA',
            logradouro: 'Brasil',
          }),
        ),
  );
  expect(result).toMatchObject({
    cnpj,
    legal_name: 'Empresa recuperada',
    street: 'AVENIDA Brasil',
  });
});
