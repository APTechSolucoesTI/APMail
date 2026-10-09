import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, unlink, copyFile, realpath, lstat, open } from 'node:fs/promises';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { Kysely } from 'kysely';
import type { DB } from './types.js';
import { assertStorageGrowth, lockStorageTenant } from './quotas.js';
import {
  beginStorageOperation,
  observeStorageFile,
  failStorageOperation,
  inferStorageOwner,
} from './metering-files.js';
export class Storage {
  readonly root: string;
  constructor(
    root: string,
    private readonly db?: Kysely<DB>,
  ) {
    this.root = resolve(root);
  }
  /** Files and payload admission share the caller's tenant lock and transaction. */
  withDatabase(db: Kysely<DB>) {
    return new Storage(this.root, db);
  }
  private async admission(relativePath: string) {
    if (!this.db) return async () => {};
    const owner = await inferStorageOwner(this.db, relativePath);
    if (!owner.tenant) return async () => {};
    await lockStorageTenant(this.db, owner.tenant);
    const previous = await this.db
      .selectFrom('storage_assets')
      .select(['present_bytes', 'state'])
      .where('storage_key', '=', relativePath)
      .executeTakeFirst();
    const oldBytes =
      previous && ['present', 'unreadable'].includes(previous.state)
        ? BigInt(previous.present_bytes ?? 0)
        : 0n;
    return async (bytes: bigint) =>
      assertStorageGrowth(this.db!, owner.tenant!, owner.box, bytes - oldBytes);
  }
  private async path(relativePath: string, create = true): Promise<string> {
    if (
      !relativePath ||
      isAbsolute(relativePath) ||
      relativePath.split(/[\\/]/).some((part) => part === '..' || !part) ||
      relativePath.includes(':')
    )
      throw new Error('Caminho de arquivo inválido.');
    const target = resolve(this.root, relativePath);
    if (!target.startsWith(this.root + sep)) throw new Error('Caminho de arquivo inválido.');
    if (create) await mkdir(this.root, { recursive: true });
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
    if (create) await mkdir(dirname(target), { recursive: true });
    let canonicalRoot: string, canonicalParent: string;
    try {
      canonicalRoot = await realpath(this.root);
      canonicalParent = await realpath(dirname(target));
    } catch (error) {
      if (!create && (error as NodeJS.ErrnoException).code === 'ENOENT') return target;
      throw error;
    }
    if (!canonicalParent.startsWith(canonicalRoot + sep) && dirname(target) !== this.root)
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
    if (this.db && !this.db.isTransaction) {
      await this.db
        .transaction()
        .execute((tx) => this.withDatabase(tx).writeFile(relativePath, source));
      return;
    }
    const check = await this.admission(relativePath);
    if (Buffer.isBuffer(source)) await check(BigInt(source.length));
    const destination = await this.path(relativePath);
    const operation = this.db
      ? await beginStorageOperation(this.db, relativePath, 'write')
      : undefined;
    const temporary = `${destination}.${randomUUID()}.tmp`;
    let published = false;
    try {
      async function* checkedStream() {
        let bytes = 0n;
        for await (const chunk of source as Readable) {
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
          bytes += BigInt(buffer.length);
          await check(bytes);
          yield buffer;
        }
      }
      await pipeline(
        Buffer.isBuffer(source) ? Readable.from(source) : Readable.from(checkedStream()),
        createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      );
      await rename(temporary, destination);
      published = true;
      if (this.db)
        await observeStorageFile(
          this.db,
          relativePath,
          await lstat(destination, { bigint: true }),
          operation,
        );
    } catch (error) {
      if (this.db && operation)
        await failStorageOperation(this.db, operation).catch(() => undefined);
      await unlink(temporary).catch(() => undefined);
      if (published) await unlink(destination).catch(() => undefined);
      throw error;
    }
  }
  /** Append one bounded upload block under the caller's tenant lock. The database checkpoint
   * is authoritative: truncate any tail left by a process crash or rolled-back transaction.
   * Never rewrite the entire archive or create a second full-size copy. */
  async appendFile(
    relativePath: string,
    source: Buffer,
    offset: number,
    validate?: () => Promise<void>,
  ): Promise<void> {
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('Offset inválido.');
    if (this.db && !this.db.isTransaction) {
      await this.db
        .transaction()
        .execute((tx) => this.withDatabase(tx).appendFile(relativePath, source, offset, validate));
      return;
    }
    const check = await this.admission(relativePath);
    await check(BigInt(offset + source.length));
    const destination = await this.path(relativePath);
    const handle = await open(destination, 'r+').catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT' || offset !== 0) throw error;
      return open(destination, 'wx+', 0o600);
    });
    let operation: string | undefined;
    let appended = false;
    let failed = false;
    try {
      if ((await handle.stat()).size < offset) throw new Error('Arquivo de upload incompleto.');
      await handle.truncate(offset);
      operation = this.db ? await beginStorageOperation(this.db, relativePath, 'write') : undefined;
      appended = true;
      let written = 0;
      while (written < source.length) {
        const { bytesWritten } = await handle.write(
          source,
          written,
          source.length - written,
          offset + written,
        );
        if (!bytesWritten) throw new Error('Não foi possível gravar o arquivo.');
        written += bytesWritten;
      }
      await handle.sync();
      await validate?.();
      if (this.db)
        await observeStorageFile(
          this.db,
          relativePath,
          await handle.stat({ bigint: true }),
          operation,
        );
    } catch (error) {
      failed = true;
      if (appended) {
        await handle.truncate(offset);
        await handle.sync();
      }
      if (this.db && operation)
        await failStorageOperation(this.db, operation).catch(() => undefined);
      throw error;
    } finally {
      await handle.close();
      if (failed && offset === 0) await unlink(destination).catch(() => undefined);
    }
  }
  async openReadStream(
    relativePath: string,
    range?: { start: number; end: number },
  ): Promise<ReturnType<typeof createReadStream>> {
    return createReadStream(await this.path(relativePath, false), range);
  }
  /** Discard an unconfirmed upload tail, including any scanner observation of those bytes. */
  async truncateFile(relativePath: string, bytes: number): Promise<void> {
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Tamanho inválido.');
    if (this.db && !this.db.isTransaction) {
      await this.db
        .transaction()
        .execute((tx) => this.withDatabase(tx).truncateFile(relativePath, bytes));
      return;
    }
    const owner = this.db ? await inferStorageOwner(this.db, relativePath) : null;
    if (this.db && owner?.tenant) await lockStorageTenant(this.db, owner.tenant);
    const handle = await open(await this.path(relativePath, false), 'r+');
    try {
      if ((await handle.stat()).size < bytes) throw new Error('Arquivo de upload incompleto.');
      await handle.truncate(bytes);
      await handle.sync();
      if (this.db)
        await observeStorageFile(this.db, relativePath, await handle.stat({ bigint: true }));
    } finally {
      await handle.close();
    }
  }
  async removeFile(relativePath: string): Promise<void> {
    const destination = await this.path(relativePath, false);
    const operation = this.db
      ? await beginStorageOperation(this.db, relativePath, 'delete')
      : undefined;
    try {
      await unlink(destination).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
      if (this.db) await observeStorageFile(this.db, relativePath, null, operation);
    } catch (error) {
      if (this.db && operation)
        await failStorageOperation(this.db, operation).catch(() => undefined);
      throw error;
    }
  }
  async copyFile(from: string, to: string): Promise<void> {
    if (this.db && !this.db.isTransaction) {
      await this.db.transaction().execute((tx) => this.withDatabase(tx).copyFile(from, to));
      return;
    }
    const source = await this.path(from, false),
      destination = await this.path(to);
    await (
      await this.admission(to)
    )((await lstat(source, { bigint: true })).size);
    const operation = this.db ? await beginStorageOperation(this.db, to, 'copy') : undefined;
    const temporary = `${destination}.${randomUUID()}.tmp`;
    let published = false;
    try {
      await copyFile(source, temporary);
      await rename(temporary, destination);
      published = true;
      if (this.db)
        await observeStorageFile(
          this.db,
          to,
          await lstat(destination, { bigint: true }),
          operation,
        );
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      if (published) await unlink(destination).catch(() => undefined);
      if (this.db && operation)
        await failStorageOperation(this.db, operation).catch(() => undefined);
      throw error;
    }
  }
  /** Safe metadata-only observation; the scanner never follows symbolic links. */
  async inspect(relativePath: string) {
    try {
      return await lstat(await this.path(relativePath, false), { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
}
