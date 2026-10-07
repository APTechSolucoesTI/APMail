import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireTenant, ApiError } from '../authz/context.js';
import { registerContactDirectory } from './contact-directory.js';
import type { Resources } from './resources.js';
export { contactVisible, contactSearch, contactNickname } from './contact-directory.js';
export async function registerContacts(app: FastifyInstance, r: Resources) {
  await registerContactDirectory(app, r);
  for (const kind of ['cep', 'cnpj'] as const)
    app.get(
      '/api/contacts/lookup/' + kind + '/:value',
      { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
      async (req) => {
        requireTenant(req.ctx);
        const raw = z.object({ value: z.string().max(30) }).parse(req.params).value;
        const value = raw.replace(/[.\-/\s]/g, '').toUpperCase();
        if (!(kind === 'cep' ? /^\d{8}$/ : /^[A-Z\d]{12}\d{2}$/).test(value))
          throw new ApiError(
            400,
            'validation_error',
            kind === 'cep' ? 'CEP deve ter 8 números.' : 'CNPJ deve ter 14 caracteres.',
          );
        const key = `lookup:${kind}:${value}`,
          cached = await r.redis.get(key);
        if (cached) return JSON.parse(cached);
        let response: Response;
        let source = kind === 'cep' ? 'ViaCEP' : 'BrasilAPI';
        try {
          const primary = await fetch(
            kind === 'cep'
              ? `https://viacep.com.br/ws/${value}/json/`
              : `https://brasilapi.com.br/api/cnpj/v1/${value}`,
            { signal: AbortSignal.timeout(7000) },
          ).catch(() => null);
          if (
            kind === 'cnpj' &&
            (!primary || [403, 429].includes(primary.status) || primary.status >= 500)
          ) {
            response = await fetch(`https://minhareceita.org/${value}`, {
              signal: AbortSignal.timeout(7000),
            });
            source = 'Minha Receita';
          } else if (primary) response = primary;
          else throw new Error('lookup_unavailable');
        } catch {
          throw new ApiError(
            503,
            'lookup_unavailable',
            'Consulta indisponível. Preencha os dados manualmente.',
          );
        }
        if (!response.ok)
          throw new ApiError(
            response.status === 404 ? 404 : 503,
            'lookup_unavailable',
            'Não foi possível consultar. Preencha os dados manualmente.',
          );
        const data = (await response.json()) as Record<string, unknown>;
        if (data.erro) throw new ApiError(404, 'not_found', 'CEP não encontrado.');
        const str = (key: string) =>
          typeof data[key] === 'string' ? String(data[key]).slice(0, 200) : '';
        const result =
          kind === 'cep'
            ? {
                address: {
                  cep: value,
                  street: str('logradouro'),
                  number: '',
                  complement: str('complemento'),
                  district: str('bairro'),
                  city: str('localidade'),
                  state: str('uf'),
                  country: 'Brasil',
                },
                source: 'ViaCEP',
                queried_at: new Date().toISOString(),
              }
            : {
                company: {
                  name: str('razao_social'),
                  trade_name: str('nome_fantasia'),
                  cnpj: value,
                },
                address: {
                  cep: str('cep'),
                  street: [str('descricao_tipo_de_logradouro'), str('logradouro')]
                    .filter(Boolean)
                    .join(' '),
                  number: str('numero'),
                  complement: str('complemento'),
                  district: str('bairro'),
                  city: str('municipio'),
                  state: str('uf'),
                  country: 'Brasil',
                },
                source,
                queried_at: new Date().toISOString(),
              };
        await r.redis.set(key, JSON.stringify(result), 'EX', 3600);
        return result;
      },
    );
}
