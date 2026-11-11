import { EventEmitter } from 'node:events';
import type { RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn(), status: 204, error: false }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
import { postWebhook } from '../src/integration-webhook-http.js';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status = 204;
  mocks.error = false;
  mocks.lookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
  mocks.request.mockImplementation(
    (_url: URL, _options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      const req = Object.assign(new EventEmitter(), {
        end: () =>
          queueMicrotask(() => {
            if (mocks.error)
              req.emit('error', new Error('Internal error with potentially sensitive URL'));
            else callback({ statusCode: mocks.status, destroy: () => {} } as IncomingMessage);
          }),
      });
      return req;
    },
  );
});
it('rejeita DNS privado, inclusive se misturado a endereço público, sem abrir conexão', async () => {
  for (const address of [
    '127.0.0.1',
    '169.254.169.254',
    '192.168.3.1',
    '::ffff:127.0.0.1',
    'fc00::1',
  ]) {
    mocks.lookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address, family: address.includes(':') ? 6 : 4 },
    ]);
    await expect(postWebhook('https://events.example.com/path', '{}', {})).rejects.toThrow(
      'destination_blocked',
    );
  }
  expect(mocks.request).not.toHaveBeenCalled();
});
it('mantém hostname TLS e fixa lookup no endereço validado para impedir DNS rebinding', async () => {
  await expect(
    postWebhook('https://events.example.com/path', '{"olá":true}', { 'X-Test': 'value' }),
  ).resolves.toBe(204);
  const [url, options] = mocks.request.mock.calls[0] as [URL, RequestOptions];
  expect(url.hostname).toBe('events.example.com');
  expect(options.agent).toBe(false);
  expect(options.rejectUnauthorized).not.toBe(false);
  expect(options.headers).toMatchObject({ 'Content-Length': Buffer.byteLength('{"olá":true}') });
  expect(mocks.lookup).toHaveBeenCalledTimes(1);
  const callback = vi.fn();
  options.lookup!('events.example.com', { all: false }, callback);
  expect(callback).toHaveBeenCalledWith(null, '93.184.216.34', 4);
});
it('retorna redirecionamento sem seguir Location ou abrir segunda conexão', async () => {
  mocks.status = 302;
  expect(await postWebhook('https://events.example.com/path', '{}', {})).toBe(302);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it('valida DNS novamente a cada tentativa, bloqueando mudança para rede interna', async () => {
  await postWebhook('https://events.example.com/path', '{}', {});
  mocks.lookup.mockResolvedValue([{ address: '10.1.1.1', family: 4 }]);
  await expect(postWebhook('https://events.example.com/path', '{}', {})).rejects.toThrow(
    'destination_blocked',
  );
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it('não expõe erros internos do transporte ao histórico', async () => {
  mocks.error = true;
  await expect(postWebhook('https://events.example.com/path', '{}', {})).rejects.toThrow(
    'transport_error',
  );
});
