import { expect, it } from 'vitest';
import {
  connectionError,
  connectionErrorKind,
  connectionRetryDelay,
  isConnectionError,
} from '../src/lib/errors.js';

it.each([
  {
    code: 'ECONNRESET',
    message: 'Client network socket disconnected before secure TLS connection was established',
  },
  { code: 'ETIMEDOUT', message: 'TLS connection timed out' },
  { code: 'ERR_SSL_UNEXPECTED_EOF_WHILE_READING', message: 'SSL unexpected EOF while reading' },
  { message: 'Client network socket disconnected before secure TLS connection was established' },
])('retries interrupted TLS transport promptly (%j)', (error) => {
  expect(connectionErrorKind(error)).toBe('transient');
  expect(isConnectionError(error)).toBe(true);
  expect(connectionRetryDelay(1, connectionErrorKind(error))).toBe(15000);
  expect(connectionError(error, 'imappro.zoho.com', 993)).not.toContain('opção de segurança');
});

it.each([
  { code: 'CERT_HAS_EXPIRED', message: 'certificate has expired' },
  { code: 'ERR_TLS_CERT_ALTNAME_INVALID', message: 'Hostname does not match certificate' },
  { code: 'ESOCKET', message: 'self-signed certificate' },
])('preserves certificate validation failures (%j)', (error) => {
  expect(connectionErrorKind(error)).toBe('security');
  expect(connectionError(error, 'imappro.zoho.com', 993)).toContain('TLS');
});
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
