import type { ImapFlow } from 'imapflow';
import type { FolderSpecialUse } from '@apmail/db';
import { touchThreads } from '@apmail/db';
import type { Mailbox } from './connect.js';
import type { WorkerResources } from '../resources.js';
const uses: Record<string, FolderSpecialUse> = {
  '\\Inbox': 'inbox',
  '\\Sent': 'sent',
  '\\Drafts': 'drafts',
  '\\Trash': 'trash',
  '\\Junk': 'junk',
  '\\Archive': 'archive',
};
const names: Record<string, FolderSpecialUse> = {
  inbox: 'inbox',
  sent: 'sent',
  enviados: 'sent',
  drafts: 'drafts',
  rascunhos: 'drafts',
  trash: 'trash',
  lixeira: 'trash',
  junk: 'junk',
  spam: 'junk',
  archive: 'archive',
  arquivo: 'archive',
};
export async function syncFolders(r: WorkerResources, box: Mailbox, client: ImapFlow) {
  const list = (await client.list()).filter(
    (f) => !f.flags.has('\\Noselect') && f.specialUse !== '\\All' && !f.flags.has('\\All'),
  );
  let changed = false;
  const existing = await r.db
    .selectFrom('folders')
    .selectAll()
    .where('mailbox_id', '=', box.id)
    .where('tenant_id', '=', box.tenant_id)
    .execute();
  for (const f of list) {
    const special_use =
      f.path.toUpperCase() === 'INBOX'
        ? 'inbox'
        : (uses[f.specialUse ?? ''] ?? names[f.name.toLowerCase()] ?? null);
    const old = existing.find((e) => e.imap_path === f.path);
    const special_use_official = f.path.toUpperCase() === 'INBOX' || !!uses[f.specialUse ?? ''];
    if (!old) {
      await r.db
        .insertInto('folders')
        .values({
          tenant_id: box.tenant_id,
          mailbox_id: box.id,
          name: f.name,
          imap_path: f.path,
          delimiter: f.delimiter ?? '/',
          special_use,
          special_use_official,
        })
        .execute();
      changed = true;
    } else if (
      old.deleted_at ||
      old.name !== f.name ||
      old.special_use !== special_use ||
      old.special_use_official !== special_use_official
    ) {
      await r.db
        .updateTable('folders')
        .set({
          name: f.name,
          special_use,
          special_use_official,
          delimiter: f.delimiter ?? '/',
          deleted_at: null,
          ...(old.deleted_at ? { last_uid: 0, uidvalidity: null } : {}),
        })
        .where('id', '=', old.id)
        .execute();
      changed = true;
    }
  }
  const paths = new Set(list.map((f) => f.path));
  for (const f of existing.filter((f) => !f.deleted_at && !paths.has(f.imap_path))) {
    const ids = await r.db.transaction().execute(async (trx) => {
      await trx
        .updateTable('folders')
        .set({ deleted_at: new Date() })
        .where('id', '=', f.id)
        .execute();
      const removed = await trx
        .updateTable('messages')
        .set({ deleted_at: new Date() })
        .where('folder_id', '=', f.id)
        .where('deleted_at', 'is', null)
        .returning('thread_id')
        .execute();
      const ids = removed.map((m) => m.thread_id);
      await touchThreads(trx, ids, 'sync', null);
      return ids;
    });
    for (const thread_id of new Set(ids))
      r.io.to('thread:' + thread_id).emit('thread:messages-changed', { thread_id });
    r.io.to('mailbox:' + box.id).emit('threads:changed', { mailbox_id: box.id, thread_ids: ids });
    changed = true;
  }
  const folders = await r.db
    .selectFrom('folders')
    .selectAll()
    .where('mailbox_id', '=', box.id)
    .where('tenant_id', '=', box.tenant_id)
    .where('deleted_at', 'is', null)
    .execute();
  for (const f of folders) {
    const parentPath = f.imap_path.includes(f.delimiter)
      ? f.imap_path.slice(0, f.imap_path.lastIndexOf(f.delimiter))
      : null;
    const parent_id = folders.find((p) => p.imap_path === parentPath)?.id ?? null;
    if (f.parent_id !== parent_id) {
      await r.db.updateTable('folders').set({ parent_id }).where('id', '=', f.id).execute();
      f.parent_id = parent_id;
      changed = true;
    }
  }
  if (changed) r.io.to('mailbox:' + box.id).emit('folders:changed', { mailbox_id: box.id });
  return folders.sort(
    (a, b) =>
      (a.special_use === 'inbox' ? -2 : a.special_use === 'sent' ? -1 : 0) -
        (b.special_use === 'inbox' ? -2 : b.special_use === 'sent' ? -1 : 0) ||
      a.name.localeCompare(b.name, 'pt-BR'),
  );
}
