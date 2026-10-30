import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import type { DB, FolderSpecialUse } from '../types.js';
import { touchThreads } from './threads.js';

type Folder = Selectable<DB['folders']>;
type Mailbox = Pick<Selectable<DB['mailboxes']>, 'id' | 'tenant_id' | 'receiving_protocol'>;
const legacyRoot = 'local/importados';
const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
const wrappers = new Set([
  'importados',
  'inicio do arquivo de dados do outlook',
  'top of outlook data file',
  'top of personal folders',
  'personal folders',
  'pastas particulares',
  'ipm_subtree',
]);
const standard: Record<string, FolderSpecialUse> = {
  inbox: 'inbox',
  'caixa de entrada': 'inbox',
  sent: 'sent',
  enviados: 'sent',
  'itens enviados': 'sent',
  'sent items': 'sent',
  'sent mail': 'sent',
  drafts: 'drafts',
  rascunhos: 'drafts',
  trash: 'trash',
  lixeira: 'trash',
  'itens excluidos': 'trash',
  'deleted items': 'trash',
  'deleted messages': 'trash',
  junk: 'junk',
  spam: 'junk',
  'lixo eletronico': 'junk',
  'junk email': 'junk',
  'junk e-mail': 'junk',
  archive: 'archive',
  arquivo: 'archive',
  arquivos: 'archive',
};
const labels: Record<FolderSpecialUse, string> = {
  inbox: 'Caixa de entrada',
  sent: 'Enviados',
  drafts: 'Rascunhos',
  trash: 'Lixeira',
  junk: 'Spam',
  archive: 'Arquivo',
};
const isLegacy = (folder: Folder) =>
  folder.is_local &&
  (folder.imap_path === legacyRoot || folder.imap_path.startsWith(legacyRoot + '/'));

/** Caller serializes with the mailbox worker lock. Imported content remains local. */
export async function createArchiveFolderResolver(db: Kysely<DB>, mailbox: Mailbox) {
  const folders = await db
    .selectFrom('folders')
    .selectAll()
    .where('tenant_id', '=', mailbox.tenant_id)
    .where('mailbox_id', '=', mailbox.id)
    .where('deleted_at', 'is', null)
    .execute();
  async function insert(
    name: string,
    path: string,
    parent: Folder | null,
    use: FolderSpecialUse | null,
    relocate?: Folder,
  ) {
    if (relocate) {
      const row = await db
        .updateTable('folders')
        .set({ name, imap_path: path, parent_id: parent?.id ?? null })
        .where('tenant_id', '=', mailbox.tenant_id)
        .where('mailbox_id', '=', mailbox.id)
        .where('id', '=', relocate.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      const cached = folders.find((f) => f.id === row.id);
      if (cached) Object.assign(cached, row);
      else folders.push(row);
      return row;
    }
    await db
      .insertInto('folders')
      .values({
        tenant_id: mailbox.tenant_id,
        mailbox_id: mailbox.id,
        name,
        imap_path: path,
        parent_id: parent?.id ?? null,
        special_use: use,
        special_use_official: !!use,
        is_local: true,
      })
      .onConflict((oc) =>
        oc.columns(['mailbox_id', 'imap_path']).where('deleted_at', 'is', null).doNothing(),
      )
      .execute();
    const row = await db
      .selectFrom('folders')
      .selectAll()
      .where('tenant_id', '=', mailbox.tenant_id)
      .where('mailbox_id', '=', mailbox.id)
      .where('imap_path', '=', path)
      .where('deleted_at', 'is', null)
      .executeTakeFirstOrThrow();
    folders.push(row);
    return row;
  }
  async function special(use: FolderSpecialUse) {
    return (
      folders
        .filter((f) => f.special_use === use && !isLegacy(f))
        .sort(
          (a, b) =>
            Number(b.special_use_official) - Number(a.special_use_official) ||
            Number(a.is_local) - Number(b.is_local) ||
            a.id.localeCompare(b.id),
        )[0] ?? (await insert(labels[use], 'local/' + use, null, use))
    );
  }
  return async (source: string, relocate?: Folder, format?: string): Promise<Folder> => {
    const parts = source
      .replace(/\0/g, '')
      .split(/[\\/]+/)
      .filter((p) => p && p !== '.' && p !== '..')
      .map((p) => p.slice(0, 100))
      .slice(0, 100);
    let parent: Folder | null = null;
    if (mailbox.receiving_protocol === 'local') {
      const names = ['Importados', ...parts];
      let path = 'local';
      for (const name of names) {
        path = (path + '/' + name).slice(0, 900);
        // Match the historic root's lowercase storage path.
        if (!parent) path = legacyRoot;
        const child: Folder =
          folders.find((f) => f.imap_path === path) ?? (await insert(name, path, parent, null));
        if (child.parent_id !== (parent?.id ?? null)) {
          await db
            .updateTable('folders')
            .set({ parent_id: parent?.id ?? null })
            .where('tenant_id', '=', mailbox.tenant_id)
            .where('mailbox_id', '=', mailbox.id)
            .where('id', '=', child.id)
            .execute();
          child.parent_id = parent?.id ?? null;
        }
        parent = child;
      }
      return parent!;
    }
    if (format && ['eml', 'emlx', 'mbox'].includes(format)) parts.length = 0;
    while (parts.length && wrappers.has(normalize(parts[0]!))) parts.shift();
    const key = parts.length ? normalize(parts[0]!) : 'inbox';
    const use = Object.hasOwn(standard, key) ? standard[key] : undefined;
    if (use) {
      parent = await special(use);
      if (parts.length) parts.shift();
    }
    for (const [index, name] of parts.entries()) {
      const path = (
        (parent
          ? parent.is_local
            ? parent.imap_path
            : 'local/folders/' + parent.id
          : 'local/folders') +
        '/' +
        name
      ).slice(0, 900);
      const existing = folders.find(
        (f) =>
          !isLegacy(f) &&
          f.parent_id === (parent?.id ?? null) &&
          normalize(f.name) === normalize(name),
      );
      parent =
        existing ??
        (await insert(name, path, parent, null, index === parts.length - 1 ? relocate : undefined));
    }
    return parent ?? (await special('inbox'));
  };
}

/** Reversible data maintenance; run in a transaction under the same mailbox lock as imports. */
export async function reorganizeArchiveFolders(
  tx: Transaction<DB>,
  tenant: string,
  mailboxId: string,
) {
  const mailbox = await tx
    .selectFrom('mailboxes')
    .selectAll()
    .where('id', '=', mailboxId)
    .where('tenant_id', '=', tenant)
    .where('deleted_at', 'is', null)
    .forUpdate()
    .executeTakeFirstOrThrow();
  const result = {
    movedMessages: 0,
    relocatedFolders: 0,
    retiredFolders: 0,
    mappings: [] as { from: string; to: string }[],
  };
  if (mailbox.receiving_protocol === 'local') return result;
  const active = await tx
    .selectFrom('mail_archive_imports')
    .select('id')
    .where('tenant_id', '=', tenant)
    .where('mailbox_id', '=', mailboxId)
    .where('state', 'in', ['queued', 'running'])
    .executeTakeFirst();
  if (active) throw new Error('Aguarde a importação em andamento antes de reorganizar esta caixa.');
  const pendingAction = await tx
    .selectFrom('mail_actions')
    .select('id')
    .where('tenant_id', '=', tenant)
    .where('mailbox_id', '=', mailboxId)
    .where('status', 'in', ['pending', 'processing'])
    .executeTakeFirst();
  if (pendingAction) throw new Error('Aguarde as ações de organização pendentes desta caixa.');
  const all = await tx
    .selectFrom('folders')
    .selectAll()
    .where('tenant_id', '=', tenant)
    .where('mailbox_id', '=', mailboxId)
    .where('deleted_at', 'is', null)
    .execute();
  const sources = all
    .filter(isLegacy)
    .sort(
      (a, b) =>
        a.imap_path.split('/').length - b.imap_path.split('/').length ||
        a.imap_path.localeCompare(b.imap_path),
    );
  const resolve = await createArchiveFolderResolver(tx, mailbox);
  const changedThreads = new Set<string>();
  for (const source of sources) {
    const sourcePath =
      source.imap_path === legacyRoot ? '' : source.imap_path.slice(legacyRoot.length + 1);
    const destination = await resolve(sourcePath, source);
    result.mappings.push({ from: source.id, to: destination.id });
    if (source.id === destination.id) {
      result.relocatedFolders++;
      continue;
    }
    const otherMail = await tx
      .selectFrom('messages')
      .select('id')
      .where('tenant_id', '=', tenant)
      .where('mailbox_id', '=', mailboxId)
      .where('folder_id', '=', source.id)
      .where('source_kind', '!=', 'archive')
      .executeTakeFirst();
    if (otherMail)
      throw new Error(
        'Uma pasta importada contém mensagens de outra origem; revise antes de unir.',
      );
    // Merging folder grants must never expose other mail in the destination.
    const grants = await tx
      .selectFrom('folder_permissions')
      .select('user_id')
      .where('tenant_id', '=', tenant)
      .where('mailbox_id', '=', mailboxId)
      .where('folder_id', '=', source.id)
      .execute();
    for (const grant of grants) {
      if (
        !(await tx
          .selectFrom('folder_permissions')
          .select('user_id')
          .where('tenant_id', '=', tenant)
          .where('mailbox_id', '=', mailboxId)
          .where('folder_id', '=', destination.id)
          .where('user_id', '=', grant.user_id)
          .executeTakeFirst())
      )
        throw new Error('A união destas pastas exige revisar permissões restritas.');
    }
    const moved = await tx
      .updateTable('messages')
      .set({ folder_id: destination.id, rules_inbox: destination.special_use === 'inbox' })
      .where('tenant_id', '=', tenant)
      .where('mailbox_id', '=', mailboxId)
      .where('folder_id', '=', source.id)
      .where('source_kind', '=', 'archive')
      .returning('thread_id')
      .execute();
    result.movedMessages += moved.length;
    if (destination.special_use === 'trash' || destination.special_use === 'junk')
      moved.forEach((m) => changedThreads.add(m.thread_id));
  }
  for (const source of [...sources].reverse()) {
    const retired = await sql<{
      id: string;
    }>`update folders f set deleted_at=now() where f.id=${source.id}::uuid and f.tenant_id=${tenant}::uuid and f.mailbox_id=${mailboxId}::uuid and (f.imap_path=${legacyRoot} or f.imap_path like ${legacyRoot + '/%'}) and not exists(select 1 from messages m where m.folder_id=f.id) and not exists(select 1 from folders child where child.parent_id=f.id and child.deleted_at is null) returning f.id`.execute(
      tx,
    );
    result.retiredFolders += retired.rows.length;
  }
  await touchThreads(tx, [...changedThreads], 'sync', null);
  return result;
}
