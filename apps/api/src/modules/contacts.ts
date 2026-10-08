import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireTenant, ApiError } from '../authz/context.js';
import { registerContactDirectory } from './contact-directory.js';
import type { Resources } from './resources.js';
export { contactVisible, contactSearch, contactNickname } from './contact-directory.js';
export async function registerContacts(app: FastifyInstance, r: Resources) {
  await registerContactDirectory(app, r);
  app.get(
    '/api/contacts/lookup/cep/:value',
    {
      config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
    },
    async (req) => {
      requireTenant(req.ctx);
      const value = z
        .object({ value: z.string().max(30) })
        .parse(req.params)
        .value.replace(/[.\-/\s]/g, '');
      if (!/^\d{8}$/.test(value))
        throw new ApiError(400, 'validation_error', 'CEP deve ter 8 números.');
      const key = 'lookup:cep:' + value,
        cached = await r.redis.get(key);
      if (cached) return JSON.parse(cached);
      let response: Response;
      try {
        response = await fetch(`https://viacep.com.br/ws/${value}/json/`, {
          signal: AbortSignal.timeout(7000),
        });
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
      const result = {
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
      };
      await r.redis.set(key, JSON.stringify(result), 'EX', 3600);
      return result;
    },
  );
}
