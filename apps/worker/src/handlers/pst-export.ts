import { readdir, realpath } from 'node:fs/promises';
import { resolve, relative, sep, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { sql } from 'kysely';
import {
  backupMime,
  toMbox,
  lockStorageTenant,
  observeStorageFile,
  assertStorageCapacity,
  isStorageQuotaError,
  audit,
  registerSecurityFile,
  enqueueSecurityScan,
} from '@apmail/db';
import { MAIL_MESSAGE_MAX_BYTES } from '@apmail/shared';
import { withMailboxLock } from '../lib/mailbox-lock.js';
import type { WorkerResources } from '../resources.js';

type ExportIdentity = { id: string; tenant_id: string; mailbox_id: string };
const directory = (task: ExportIdentity) =>
  `mail-exports/${task.tenant_id}/${task.mailbox_id}/${task.id}`;
const activeStates = ['queued', 'staging', 'converting'];
const eventSchema = z.object({
  type: z.string(),
  converted: z.number().int().nonnegative().optional(),
  warnings: z.number().int().nonnegative().optional(),
  skipped: z.number().int().nonnegative().optional(),
  outputs: z.array(z.string()).max(1000).optional(),
});

async function jobFiles(
  r: WorkerResources,
  task: ExportIdentity,
  path = directory(task),
): Promise<string[]> {
  const info = await r.storage.inspect(path);
  if (!info) return [];
  if (info.isSymbolicLink()) throw new Error('Arquivo temporário inválido.');
  if (!info.isDirectory()) return [path];
  const names = await readdir(resolve(r.storage.root, path));
  const children = await Promise.all(names.map((name) => jobFiles(r, task, path + '/' + name)));
  return children.flat();
}
async function observe(r: WorkerResources, task: ExportIdentity, checkQuota = true) {
  const paths = await jobFiles(r, task);
  await r.db.transaction().execute(async (tx) => {
    await lockStorageTenant(tx, task.tenant_id);
    for (const path of paths) await observeStorageFile(tx, path, await r.storage.inspect(path));
    // Observations survive over-quota writes: record reality before rejecting the conversion.
  });
  if (checkQuota)
    await r.db.transaction().execute(async (tx) => {
      await assertStorageCapacity(tx, task.tenant_id, task.mailbox_id);
    });
}
async function live(r: WorkerResources, task: ExportIdentity) {
  return !!(await r.db
    .selectFrom('mail_archive_exports as e')
    .innerJoin('mailboxes as b', 'b.id', 'e.mailbox_id')
    .select('e.id')
    .where('e.id', '=', task.id)
    .where('e.state', 'in', activeStates)
    .where('b.deleted_at', 'is', null)
    .executeTakeFirst());
}
async function cleanFiles(
  r: WorkerResources,
  task: ExportIdentity,
  keep: Set<string>,
  automatic = false,
) {
  for (const path of await jobFiles(r, task)) {
    if (keep.has(path)) continue;
    if (automatic && path.toLowerCase().endsWith('.pst')) {
      await r.db.transaction().execute(async (tx) => {
        const verdict = await sql<{ status: string }>`select status from file_security
          where storage_key=${path} for update`.execute(tx);
        if (verdict.rows[0]?.status !== 'clean') return;
        await r.storage.withDatabase(tx).removeFile(path);
        await tx
          .deleteFrom('mail_archive_export_files')
          .where('export_id', '=', task.id)
          .where('storage_path', '=', path)
          .execute();
      });
      continue;
    }
    await r.storage.removeFile(path);
    await r.db
      .deleteFrom('mail_archive_export_files')
      .where('export_id', '=', task.id)
      .where('storage_path', '=', path)
      .execute();
  }
}

export async function handlePstExport(r: WorkerResources, exportId: string, jobId: string) {
  const task = await r.db
    .selectFrom('mail_archive_exports')
    .selectAll()
    .where('id', '=', exportId)
    .executeTakeFirst();
  if (!task || !activeStates.includes(task.state)) return;
  const result = await withMailboxLock(
    r.redis,
    task.mailbox_id,
    jobId,
    async () => {
      const started = await r.db
        .updateTable('mail_archive_exports')
        .set({ state: 'staging', last_error: null, converted: 0, updated_at: new Date() })
        .where('id', '=', task.id)
        .where('state', 'in', activeStates)
        .returning('id')
        .executeTakeFirst();
      if (!started) return;
      const emit = () =>
        r.io
          .to('mailbox:' + task.mailbox_id)
          .emit('mail:archive-progress', { mailbox_id: task.mailbox_id, export_id: task.id });
      try {
        if (!(await live(r, task))) throw new Error('Exportação interrompida.');
        const folders = await r.db
          .selectFrom('folders')
          .select(['id', 'name', 'parent_id'])
          .where('tenant_id', '=', task.tenant_id)
          .where('mailbox_id', '=', task.mailbox_id)
          .$if(!task.include_deleted, (q) => q.where('deleted_at', 'is', null))
          .execute();
        const folderMap = new Map(folders.map((f) => [f.id, f]));
        const folderPath = (id: string) => {
          const segments: string[] = [],
            seen = new Set<string>();
          let folder = folderMap.get(id);
          while (folder) {
            if (seen.has(folder.id) || seen.size >= 100)
              throw new Error('A hierarquia de pastas não pôde ser exportada.');
            seen.add(folder.id);
            segments.unshift(folder.name.replaceAll('\u0000', '\uFFFD'));
            folder = folder.parent_id ? folderMap.get(folder.parent_id) : undefined;
          }
          return segments.length ? segments : ['Mensagens'];
        };
        const sources = new Map(
          (
            await r.db
              .selectFrom('mail_archive_export_files')
              .selectAll()
              .where('export_id', '=', task.id)
              .where('kind', '=', 'source')
              .execute()
          ).map((f) => [f.folder_id ?? 'unfiled', f]),
        );
        const ensureSource = async (folderId: string | null) => {
          const key = folderId ?? 'unfiled';
          const existing = sources.get(key);
          if (existing) return existing;
          const path = directory(task) + '/input/' + key + '.mbox';
          await r.storage.writeFile(path, Buffer.alloc(0));
          const created = await r.db
            .insertInto('mail_archive_export_files')
            .values({
              export_id: task.id,
              tenant_id: task.tenant_id,
              mailbox_id: task.mailbox_id,
              kind: 'source',
              folder_id: folderId,
              folder_path: folderId ? folderPath(folderId) : ['Mensagens sem pasta'],
              filename: key + '.mbox',
              storage_path: path,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          sources.set(key, created);
          return created;
        };
        for (const folder of folders.filter((f) => !task.folder_id || task.folder_id === f.id))
          await ensureSource(folder.id);
        let cursor = task.last_message_id ?? '00000000-0000-0000-0000-000000000000',
          prepared = task.prepared;
        for (;;) {
          if (!(await live(r, task))) throw new Error('Exportação interrompida.');
          const messages = await r.db
            .selectFrom('messages')
            .selectAll()
            .where('tenant_id', '=', task.tenant_id)
            .where('mailbox_id', '=', task.mailbox_id)
            .where('created_at', '<=', task.cutoff_at)
            .where('id', '>', cursor)
            .$if(!task.include_deleted, (q) => q.where('deleted_at', 'is', null))
            .$if(!!task.folder_id, (q) => q.where('folder_id', '=', task.folder_id!))
            .where((eb) =>
              eb.or([
                eb('raw_storage_path', 'is not', null),
                eb('body_text', '!=', ''),
                eb('body_html', 'is not', null),
              ]),
            )
            .orderBy('id')
            .limit(25)
            .execute();
          if (!messages.length) break;
          for (const message of messages) {
            const chunks: Buffer[] = [];
            let size = 0;
            // MAPI strings terminate at NUL. Use the already-normalized database
            // text so an old PST cannot silently truncate the exported body.
            // Binary attachment streams are preserved without normalization.
            const stream = await backupMime(r.db, r.storage, message, { preferRaw: false });
            try {
              for await (const value of stream) {
                const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
                size += chunk.length;
                if (size > MAIL_MESSAGE_MAX_BYTES)
                  throw new Error('Uma mensagem excede o limite de 50 MiB para exportação.');
                chunks.push(chunk);
              }
            } finally {
              stream.destroy();
            }
            const raw = toMbox(Buffer.concat(chunks), message.message_at, message.from_address);
            const source = await ensureSource(message.folder_id);
            const nextBytes = BigInt(source.size_bytes) + BigInt(raw.length);
            await r.db.transaction().execute(async (tx) => {
              await lockStorageTenant(tx, task.tenant_id);
              await r.storage
                .withDatabase(tx)
                .appendFile(source.storage_path, raw, Number(source.size_bytes));
              const saved = await tx
                .updateTable('mail_archive_exports')
                .set({
                  prepared: prepared + 1,
                  last_message_id: message.id,
                  updated_at: new Date(),
                })
                .where('id', '=', task.id)
                .where('state', '=', 'staging')
                .returning('id')
                .executeTakeFirst();
              if (!saved) throw new Error('Exportação interrompida.');
              await tx
                .updateTable('mail_archive_export_files')
                .set({ size_bytes: nextBytes.toString() })
                .where('id', '=', source.id)
                .execute();
            });
            source.size_bytes = nextBytes.toString();
            prepared++;
            cursor = message.id;
            if (prepared % 25 === 0) emit();
          }
        }
        for (const source of sources.values())
          await r.storage.truncateFile(source.storage_path, Number(source.size_bytes));
        const root = directory(task),
          output = root + '/output';
        // A retry preserves staged messages, but rebuilds an incomplete PST from those sources.
        for (const path of await jobFiles(r, task))
          if (path.startsWith(output + '/')) await r.storage.removeFile(path);
        await r.db
          .deleteFrom('mail_archive_export_files')
          .where('export_id', '=', task.id)
          .where('kind', '=', 'pst')
          .execute();
        const configPath = root + '/config.json';
        await r.storage.writeFile(
          configPath,
          Buffer.from(
            JSON.stringify({
              outputs: [
                {
                  name: 'backup',
                  maxSizeMB: 40000,
                  folderMapping: 'mirror',
                  includeEmptyFolders: true,
                  sources: [...sources.values()].map((source) => ({
                    path: resolve(r.storage.root, source.storage_path),
                    type: 'mbox',
                    targetFolderPath: source.folder_path,
                  })),
                },
              ],
            }),
          ),
        );
        const converting = await r.db
          .updateTable('mail_archive_exports')
          .set({ state: 'converting', total_messages: prepared, updated_at: new Date() })
          .where('id', '=', task.id)
          .where('state', '=', 'staging')
          .returning('id')
          .executeTakeFirst();
        if (!converting) return;
        emit();
        const child = spawn(
          r.env.PST_EXPORT_COMMAND,
          [
            r.env.PST_EXPORT_DLL,
            'convert',
            '--config',
            resolve(r.storage.root, configPath),
            '--output',
            resolve(r.storage.root, output),
          ],
          {
            stdio: ['pipe', 'pipe', 'pipe'],
            windowsHide: true,
            shell: false,
            env: {
              PATH: process.env.PATH,
              SystemRoot: process.env.SystemRoot,
              TMP: process.env.TMP,
              TEMP: process.env.TEMP,
              LANG: process.env.LANG,
              LC_ALL: process.env.LC_ALL,
              DOTNET_ROOT: process.env.DOTNET_ROOT,
              DOTNET_CLI_TELEMETRY_OPTOUT: '1',
              DOTNET_NOLOGO: '1',
            },
          },
        );
        const exited = new Promise<number | null>((resolveExit, reject) => {
          child.once('error', reject);
          child.once('close', (code) => resolveExit(code));
        });
        // Attach rejection immediately, including failures before stdout starts producing events.
        void exited.catch(() => undefined);
        child.stderr.resume();
        child.stdin.on('error', () => undefined);
        let done: z.infer<typeof eventSchema> | undefined,
          problem: Error | undefined,
          checking = false,
          lastEvent = Date.now();
        const stop = () => {
          if (child.exitCode !== null || child.killed) return;
          if (!child.stdin.destroyed) child.stdin.write('cancel\n');
          child.kill('SIGTERM');
        };
        const monitor = setInterval(() => {
          if (checking) return;
          checking = true;
          void (async () => {
            if (Date.now() - lastEvent > 1800000)
              throw new Error('O gerador ficou sem progresso por 30 minutos. Tente novamente.');
            if (!(await live(r, task))) throw new Error('Exportação interrompida.');
            await observe(r, task);
            await r.db
              .updateTable('mail_archive_exports')
              .set({ updated_at: new Date() })
              .where('id', '=', task.id)
              .where('state', '=', 'converting')
              .execute();
          })()
            .catch((error) => {
              problem = error instanceof Error ? error : new Error('Exportação interrompida.');
              stop();
            })
            .finally(() => {
              checking = false;
            });
        }, 2000);
        const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
        try {
          for await (const line of lines) {
            if (line.length > 131072) throw new Error('Resposta inválida do gerador de PST.');
            const event = eventSchema.parse(JSON.parse(line));
            lastEvent = Date.now();
            if (event.type === 'error' || event.type === 'cancelled')
              throw new Error('O gerador não conseguiu concluir o PST. Tente novamente.');
            if (event.type === 'progress') {
              await r.db
                .updateTable('mail_archive_exports')
                .set({
                  converted: event.converted ?? 0,
                  warnings: event.warnings ?? 0,
                  updated_at: new Date(),
                })
                .where('id', '=', task.id)
                .where('state', '=', 'converting')
                .execute();
              emit();
            }
            if (event.type === 'done') done = event;
          }
          const code = await exited;
          if (problem) throw problem;
          if (
            code !== 0 ||
            !done ||
            done.converted !== prepared ||
            done.skipped !== 0 ||
            !done.outputs?.length
          )
            throw new Error(
              'O PST não contém todas as mensagens esperadas. O backup não foi liberado.',
            );
          if ((done.warnings ?? 0) > 0)
            throw new Error(
              'O gerador sinalizou problemas no conteúdo. O PST não foi liberado para evitar um backup incompleto.',
            );
        } catch (error) {
          stop();
          const killAfter = setTimeout(() => child.kill('SIGKILL'), 5000);
          killAfter.unref();
          try {
            await exited.catch(() => null);
          } finally {
            clearTimeout(killAfter);
          }
          throw error;
        } finally {
          clearInterval(monitor);
          lines.close();
        }
        await observe(r, task);
        if (!(await live(r, task))) throw new Error('Exportação interrompida.');
        const outputs = done!.outputs!;
        const canonicalOutput = await realpath(resolve(r.storage.root, output));
        for (let index = 0; index < outputs.length; index++) {
          const fullPath = await realpath(resolve(outputs[index]!));
          const childPath = relative(canonicalOutput, fullPath);
          if (
            !childPath ||
            childPath.startsWith('..') ||
            childPath.includes(sep) ||
            !childPath.toLowerCase().endsWith('.pst')
          )
            throw new Error('Saída inválida do gerador de PST.');
          const path = output + '/' + basename(childPath),
            stats = await r.storage.inspect(path);
          if (!stats?.isFile()) throw new Error('O arquivo PST não foi encontrado.');
          const filename =
            outputs.length === 1
              ? task.filename
              : task.filename.replace(/\.pst$/i, `-parte-${index + 1}.pst`);
          const file = await r.db.transaction().execute(async (tx) => {
            await tx
              .insertInto('mail_archive_export_files')
              .values({
                export_id: task.id,
                tenant_id: task.tenant_id,
                mailbox_id: task.mailbox_id,
                kind: 'pst',
                filename,
                storage_path: path,
                size_bytes: stats.size.toString(),
              })
              .execute();
            return registerSecurityFile(tx, {
              storage_key: path,
              tenant_id: task.tenant_id,
              mailbox_id: task.mailbox_id,
              user_id: task.created_by,
              resource_id: task.id,
              kind: 'mail_export',
              filename,
              content_type: 'application/vnd.ms-outlook',
              size_bytes: Number(stats.size),
            });
          });
          await enqueueSecurityScan(r.queues['antivirus-scan'], file).catch(() =>
            r.log.warn(
              { export_id: task.id },
              'Verificação do PST aguardando recuperação da fila.',
            ),
          );
        }
        const complete = await r.db
          .updateTable('mail_archive_exports')
          .set({
            state: 'ready',
            converted: prepared,
            warnings: 0,
            expires_at: new Date(Date.now() + 86400000),
            updated_at: new Date(),
          })
          .where('id', '=', task.id)
          .where('state', '=', 'converting')
          .returning('id')
          .executeTakeFirst();
        if (!complete) return;
        const keep = new Set(
          (
            await r.db
              .selectFrom('mail_archive_export_files')
              .select('storage_path')
              .where('export_id', '=', task.id)
              .where('kind', '=', 'pst')
              .execute()
          ).map((f) => f.storage_path),
        );
        await cleanFiles(r, task, keep).catch(() =>
          r.log.warn({ export_id: task.id }, 'Limpeza das fontes PST será repetida.'),
        );
        await audit(r.db, {
          tenantId: task.tenant_id,
          actorId: task.created_by,
          action: 'mail.pst_exported',
          entityType: 'mailbox',
          entityId: task.mailbox_id,
          metadata: { export_id: task.id, messages: prepared, files: outputs.length },
        });
      } catch (error) {
        await observe(r, task, false).catch(() => undefined);
        const message = isStorageQuotaError(error)
          ? 'Faltou espaço temporário na cota do APMail. Libere ou amplie o armazenamento e retome a geração.'
          : error instanceof Error &&
              !/password|secret|token|[A-Z]:\\|\/opt\/|\/data\//i.test(error.message)
            ? error.message.replaceAll('\u0000', '\uFFFD').slice(0, 300)
            : 'Não foi possível gerar o PST. Tente novamente ou peça ao administrador para verificar o worker.';
        await r.db
          .updateTable('mail_archive_exports')
          .set({ state: 'failed', last_error: message, updated_at: new Date() })
          .where('id', '=', task.id)
          .where('state', 'in', activeStates)
          .execute();
        r.log.warn(
          { export_id: task.id },
          'Geração de PST interrompida; fontes confirmadas preservadas.',
        );
      } finally {
        emit();
      }
    },
    30000,
  );
  if (result === 'skipped') throw new Error('Caixa ocupada. A exportação será retomada.');
}

export async function cleanupPstExports(r: WorkerResources) {
  const tasks = await r.db
    .selectFrom('mail_archive_exports')
    .select(['id', 'tenant_id', 'mailbox_id', 'state', 'expires_at'])
    .where('state', 'in', ['ready', 'failed', 'cancelled', 'expired'])
    .where((eb) =>
      eb.or([
        eb.and([
          eb.or([
            eb('state', 'in', ['cancelled', 'expired']),
            eb.and([eb('state', '=', 'failed'), eb('expires_at', '<=', new Date())]),
          ]),
          eb.exists(
            eb
              .selectFrom('mail_archive_export_files as f')
              .select('f.id')
              .whereRef('f.export_id', '=', 'mail_archive_exports.id'),
          ),
        ]),
        eb.and([
          eb('state', '=', 'ready'),
          eb.or([
            eb('expires_at', '<=', new Date()),
            eb.exists(
              eb
                .selectFrom('mail_archive_export_files as f')
                .select('f.id')
                .whereRef('f.export_id', '=', 'mail_archive_exports.id')
                .where('f.kind', '=', 'source'),
            ),
          ]),
        ]),
      ]),
    )
    .orderBy('expires_at')
    .limit(250)
    .execute();
  for (const task of tasks) {
    const keep =
      task.state === 'ready' && task.expires_at > new Date()
        ? new Set(
            (
              await r.db
                .selectFrom('mail_archive_export_files')
                .select('storage_path')
                .where('export_id', '=', task.id)
                .where('kind', '=', 'pst')
                .execute()
            ).map((f) => f.storage_path),
          )
        : new Set<string>();
    if (task.state === 'failed' && task.expires_at > new Date()) continue;
    const result = await withMailboxLock(
      r.redis,
      task.mailbox_id,
      'pst-cleanup-' + task.id,
      async () => {
        const current = await r.db
          .selectFrom('mail_archive_exports')
          .select('state')
          .where('id', '=', task.id)
          .executeTakeFirst();
        if (!current || activeStates.includes(current.state)) return;
        try {
          await cleanFiles(r, task, keep, task.state !== 'cancelled');
          if (!keep.size)
            await r.db
              .updateTable('mail_archive_exports')
              .set({
                state: task.state === 'cancelled' ? 'cancelled' : 'expired',
                updated_at: new Date(),
              })
              .where('id', '=', task.id)
              .where('state', 'not in', activeStates)
              .execute();
        } catch {
          r.log.warn({ export_id: task.id }, 'Limpeza do PST será repetida.');
        }
      },
    );
    void result;
  }
}
