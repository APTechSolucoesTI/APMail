import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { encryptSecret, decryptSecret } from '../src/crypto.js';
import { Storage } from '../src/storage.js';
describe('Segurança do armazenamento', () => {
  it('criptografa com IV único e detecta chave errada e adulteração', () => {
    const key = randomBytes(32).toString('base64');
    const encrypted = encryptSecret('senha privada', key);
    expect(decryptSecret(encrypted, key)).toBe('senha privada');
    expect(encryptSecret('senha privada', key)).not.toBe(encrypted);
    expect(() => decryptSecret(encrypted, randomBytes(32).toString('base64'))).toThrow();
    const parts = encrypted.split(':');
    parts[3] = Buffer.from('adulterado').toString('base64');
    expect(() => decryptSecret(parts.join(':'), key)).toThrow();
    expect(() => decryptSecret('v2:a:b:c', key)).toThrow();
  });
  it('rejeita path traversal e grava atomicamente sem arquivo temporário residual', async () => {
    const root = await mkdtemp(join(tmpdir(), 'apmail-storage-'));
    try {
      const storage = new Storage(root);
      for (const invalid of [
        '../segredo',
        '/etc/passwd',
        'x/../../segredo',
        'C:\\segredo',
        'x\\..\\segredo',
      ])
        await expect(storage.writeFile(invalid, Buffer.from('x'))).rejects.toThrow();
      await storage.writeFile('uploads/id', Buffer.from('anexo'));
      expect(await readFile(join(root, 'uploads/id'), 'utf8')).toBe('anexo');
      expect(await readdir(join(root, 'uploads'))).toEqual(['id']);
      await storage.copyFile('uploads/id', 'attachments/id');
      expect(await readFile(join(root, 'attachments/id'), 'utf8')).toBe('anexo');
      await storage.removeFile('attachments/id');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
