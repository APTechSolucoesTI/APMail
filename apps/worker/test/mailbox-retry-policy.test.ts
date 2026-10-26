import { expect, it } from 'vitest';
import { connectionErrorKind, connectionRetryDelay, isConnectionError } from '../src/lib/errors.js';
it('distingue quedas temporárias de credenciais e segurança sem desativar TLS', () => {
  expect(connectionErrorKind({ code: 'ECONNRESET' })).toBe('transient');
  expect(connectionErrorKind({ authenticationFailed: true })).toBe('authentication');
  expect(connectionErrorKind({ code: 'CERT_HAS_EXPIRED' })).toBe('security');
  expect(isConnectionError(new Error('Conexão POP3 encerrada.'))).toBe(true);
});
it('limita a espera e espaça falhas de senha para evitar bloqueios do provedor', () => {
  expect([1, 2, 3, 4, 5, 999].map((n) => connectionRetryDelay(n, 'transient'))).toEqual([
    15000, 30000, 60000, 120000, 300000, 300000,
  ]);
  expect(connectionRetryDelay(1, 'authentication')).toBe(1800000);
  expect(connectionRetryDelay(1, 'security')).toBe(900000);
});
