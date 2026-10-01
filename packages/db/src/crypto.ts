import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
function readKey(keyB64: string): Buffer {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error('A chave de credenciais precisa conter 32 bytes.');
  return key;
}
export function encryptSecret(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', readKey(keyB64), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}
export function decryptSecret(payload: string, keyB64: string): string {
  const [version, iv, tag, ciphertext, extra] = payload.split(':');
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined || extra !== undefined)
    throw new Error('Credencial criptografada inválida.');
  const ivBuffer = Buffer.from(iv, 'base64');
  const tagBuffer = Buffer.from(tag, 'base64');
  if (ivBuffer.length !== 12 || tagBuffer.length !== 16)
    throw new Error('Credencial criptografada inválida.');
  const decipher = createDecipheriv('aes-256-gcm', readKey(keyB64), ivBuffer);
  decipher.setAuthTag(tagBuffer);
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
