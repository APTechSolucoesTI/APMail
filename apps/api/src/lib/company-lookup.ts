import { companyDetailsSchema, cnpjSchema, type CompanyDetails } from '@apmail/shared';
import { z } from 'zod';
import { ApiError } from '../authz/context.js';

const providerSchema = z.object({
  cnpj: cnpjSchema,
  razao_social: z.string().trim().min(1).max(200),
  nome_fantasia: z.string().max(200).nullish(),
  cep: z.string().max(15).nullish(),
  uf: z.string().max(2).nullish(),
  municipio: z.string().max(120).nullish(),
  tipo_logradouro: z.string().max(40).nullish(),
  descricao_tipo_de_logradouro: z.string().max(40).nullish(),
  logradouro: z.string().max(150).nullish(),
  numero: z.string().max(30).nullish(),
  complemento: z.string().max(120).nullish(),
  bairro: z.string().max(120).nullish(),
  pais: z.string().max(80).nullish(),
  email: z.string().max(254).nullish(),
  ddd_telefone_1: z.string().max(30).nullish(),
});

/** Public registration only; never persist provider responses or partners' personal data. */
export async function lookupCompany(
  value: string,
  fetcher: typeof fetch = fetch,
): Promise<CompanyDetails> {
  const cnpj = cnpjSchema.parse(value);
  const deadline = AbortSignal.timeout(8_000);
  const providers = ['https://brasilapi.com.br/api/cnpj/v1/', 'https://minhareceita.org/'];
  for (const provider of providers) {
    try {
      const response = await fetcher(provider + cnpj, {
        signal: AbortSignal.any([deadline, AbortSignal.timeout(4_000)]),
        headers: { accept: 'application/json' },
        redirect: 'error',
      });
      if (response.status === 404)
        throw new ApiError(
          404,
          'company_not_found',
          'CNPJ não encontrado. Confira o número ou preencha os dados manualmente.',
        );
      if (!response.ok) throw new Error('provider unavailable');
      // Keep the response bounded even when the upstream content length is absent or incorrect.
      const reader = response.body?.getReader();
      if (!reader) throw new Error('empty response');
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.byteLength;
          if (length > 256_000) throw new Error('oversized response');
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel();
      }
      const data = providerSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      if (data.cnpj !== cnpj) throw new Error('mismatched registration');
      const result: CompanyDetails = {
        cnpj,
        legal_name: data.razao_social,
        country: data.pais || 'Brasil',
      };
      const candidates: CompanyDetails = {
        trade_name: data.nome_fantasia ?? undefined,
        postal_code: data.cep ?? undefined,
        city: data.municipio ?? undefined,
        street:
          [data.descricao_tipo_de_logradouro || data.tipo_logradouro, data.logradouro]
            .filter(Boolean)
            .join(' ') || undefined,
        number: data.numero ?? undefined,
        complement: data.complemento ?? undefined,
        district: data.bairro ?? undefined,
        email: data.email ?? undefined,
        phone: data.ddd_telefone_1 ?? undefined,
      };
      for (const key of Object.keys(candidates) as Exclude<keyof CompanyDetails, 'state'>[]) {
        const parsed = companyDetailsSchema.shape[key].safeParse(candidates[key]);
        if (parsed.success && parsed.data) result[key] = parsed.data;
      }
      const state = companyDetailsSchema.shape.state.safeParse(data.uf);
      if (state.success && state.data) result.state = state.data;
      return companyDetailsSchema.parse(result);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (deadline.aborted) break;
    }
  }
  throw new ApiError(
    503,
    'company_lookup_unavailable',
    'Consulta de CNPJ indisponível no momento. Tente novamente ou preencha os dados manualmente.',
  );
}
