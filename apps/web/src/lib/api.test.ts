import { afterEach, expect, it, vi } from 'vitest';
import { api, ApiError } from './api';
afterEach(() => vi.unstubAllGlobals());
it('falha de rede recebe mensagem humana', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  await expect(api('/chat/conversations')).rejects.toMatchObject({
    status: 0,
    code: 'network_error',
    message: 'Não foi possível conectar. Tente novamente.',
  } satisfies Partial<ApiError>);
});
it('cancelamento continua identificável pelo cache de consultas', async () => {
  const error = new DOMException('Cancelado', 'AbortError');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error));
  await expect(api('/chat/conversations')).rejects.toBe(error);
});
it('resposta HTML de proxy indisponível não expõe detalhes técnicos', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      status: 502,
      json: () => Promise.reject(new SyntaxError('Unexpected <')),
    }),
  );
  await expect(api('/chat/conversations')).rejects.toMatchObject({
    status: 502,
    code: 'unavailable',
    message: 'O servidor está indisponível. Tente novamente.',
  });
});
