import { afterEach, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { Secret } from 'otpauth';
import {
  validAuthenticatorStep,
  protectAuthenticator,
  readAuthenticator,
  newRecoveryCodes,
  findRecoveryCode,
} from '../src/lib/totp.js';

afterEach(() => vi.restoreAllMocks());
it('valida o vetor SHA1 da RFC 6238, seis dígitos, janela curta e rejeição de reutilização', () => {
  const secret = Secret.fromUTF8('12345678901234567890').base32;
  vi.spyOn(Date, 'now').mockReturnValue(59000);
  expect(validAuthenticatorStep(secret, '287082', -1)).toBe(1);
  expect(validAuthenticatorStep(secret, '287082', 1)).toBeNull();
  expect(validAuthenticatorStep(secret, '28708', -1)).toBeNull();
  vi.mocked(Date.now).mockReturnValue(90000);
  expect(validAuthenticatorStep(secret, '287082', -1)).toBeNull();
});
it('protege o segredo com AES-GCM e vincula sua leitura ao usuário correto', () => {
  const key = randomBytes(32).toString('base64'),
    user = randomUUID(),
    secret = new Secret({ size: 20 }).base32;
  const encrypted = protectAuthenticator(secret, user, key);
  expect(encrypted).not.toContain(secret);
  expect(readAuthenticator(encrypted, user, key)).toBe(secret);
  expect(() => readAuthenticator(encrypted, randomUUID(), key)).toThrow('owner mismatch');
  expect(() => readAuthenticator(encrypted, user, randomBytes(32).toString('base64'))).toThrow();
});
it('gera códigos de recuperação aleatórios, armazena somente hashes e normaliza a digitação', () => {
  const user = randomUUID(),
    { codes, hashes } = newRecoveryCodes(user);
  expect(new Set(codes).size).toBe(10);
  expect(hashes).toHaveLength(10);
  expect(hashes.some((hash) => codes.includes(hash))).toBe(false);
  expect(findRecoveryCode(user, codes[0]!.toLowerCase().replaceAll('-', ' '), hashes)).toBe(0);
  expect(findRecoveryCode(randomUUID(), codes[0]!, hashes)).toBe(-1);
  expect(findRecoveryCode(user, codes[0]!, hashes.slice(1))).toBe(-1);
});
