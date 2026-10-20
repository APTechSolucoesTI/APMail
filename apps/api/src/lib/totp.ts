import { randomBytes, timingSafeEqual } from 'node:crypto';
import { TOTP, Secret } from 'otpauth';
import { decryptSecret, encryptSecret } from '@apmail/db';
import { z } from 'zod';
import { hashToken } from '../plugins/auth.js';

export const authenticator = (secret: string, email = '') =>
  new TOTP({ issuer: 'APMail', label: email, algorithm: 'SHA1', digits: 6, period: 30, secret });
export const newAuthenticatorSecret = () => new Secret({ size: 20 }).base32;
export function protectAuthenticator(secret: string, userId: string, key: string) {
  return encryptSecret(JSON.stringify({ userId, secret }), key);
}
export function readAuthenticator(encrypted: string, userId: string, key: string) {
  const value = z
    .object({ userId: z.uuid(), secret: z.string().regex(/^[A-Z2-7]+$/) })
    .parse(JSON.parse(decryptSecret(encrypted, key)));
  if (value.userId !== userId) throw new Error('Authenticator owner mismatch');
  return value.secret;
}
export function validAuthenticatorStep(secret: string, token: string, lastStep: string | number) {
  if (!/^\d{6}$/.test(token)) return null;
  const now = Date.now();
  const delta = authenticator(secret).validate({ token, timestamp: now, window: 1 });
  if (delta === null) return null;
  const step = Math.floor(now / 30000) + delta;
  return step > Number(lastStep) ? step : null;
}
export const recoveryHash = (userId: string, code: string) =>
  hashToken(userId + ':' + code.replace(/[\s-]/g, '').toUpperCase());
export function newRecoveryCodes(userId: string) {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(10).toString('hex').toUpperCase().match(/.{5}/g)!.join('-'),
  );
  return { codes, hashes: codes.map((code) => recoveryHash(userId, code)) };
}
export function findRecoveryCode(userId: string, code: string, hashes: string[]) {
  if (!/^[A-F0-9]{20}$/.test(code.replace(/[\s-]/g, '').toUpperCase())) return -1;
  const supplied = Buffer.from(recoveryHash(userId, code), 'hex');
  return hashes.findIndex((hash) => timingSafeEqual(Buffer.from(hash, 'hex'), supplied));
}
