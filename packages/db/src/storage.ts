import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, unlink, copyFile, realpath, lstat } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
export class Storage {
  readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private async path(relativePath: string): Promise<string> {
    if (
      !relativePath ||
      isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).some((part) => part === '..' || !part) ||
      relativePath.includes(':')
    )
      throw new Error('Caminho de arquivo inválido.');
    const target = resolve(this.root, relativePath);
    if (!target.startsWith(this.root + sep)) throw new Error('Caminho de arquivo inválido.');
    await mkdir(this.root, { recursive: true });
    let directory = dirname(target);
    while (directory !== this.root) {
      try {
        if ((await lstat(directory)).isSymbolicLink())
          throw new Error('Links simbólicos não são permitidos no armazenamento.');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      directory = dirname(directory);
    }
    await mkdir(dirname(target), { recursive: true });
    const canonicalRoot = await realpath(this.root);
    if (
      !(await realpath(dirname(target))).startsWith(canonicalRoot + sep) &&
      dirname(target) !== this.root
    )
      throw new Error('Caminho de arquivo inválido.');
    try {
      if ((await lstat(target)).isSymbolicLink())
        throw new Error('Links simbólicos não são permitidos no armazenamento.');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return target;
  }
  async writeFile(relativePath: string, source: Buffer | Readable): Promise<void> {
    const destination = await this.path(relativePath);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await pipeline(
        Buffer.isBuffer(source) ? Readable.from(source) : source,
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      await rename(temporary, destination);
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
  async openReadStream(relativePath: string): Promise<ReturnType<typeof createReadStream>> {
    return createReadStream(await this.path(relativePath));
  }
  async removeFile(relativePath: string): Promise<void> {
    await unlink(await this.path(relativePath)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
  async copyFile(from: string, to: string): Promise<void> {
    await copyFile(await this.path(from), await this.path(to));
  }
}
