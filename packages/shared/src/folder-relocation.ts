/** Input must contain only active folders from one mailbox/tenant. */
export type RelocatableFolder = {
  id: string;
  name: string;
  parent_id: string | null;
  imap_path: string;
  delimiter: string | null;
  is_local: boolean;
  special_use: string | null;
};
export function planFolderRelocation(
  folders: readonly RelocatableFolder[],
  folderId: string,
  target: { name: string; parent_id: string | null },
) {
  const source = folders.find((f) => f.id === folderId);
  if (!source) throw Error('A pasta não está mais disponível.');
  const parent = target.parent_id ? folders.find((f) => f.id === target.parent_id) : null;
  if (target.parent_id && !parent) throw Error('A pasta de destino não está mais disponível.');
  const subtree = new Set([source.id]);
  let added = true;
  while (added) {
    added = false;
    for (const f of folders)
      if (f.parent_id && subtree.has(f.parent_id) && !subtree.has(f.id)) {
        subtree.add(f.id);
        added = true;
      }
  }
  if (target.parent_id && subtree.has(target.parent_id))
    throw Error('Uma pasta não pode ser movida para si mesma ou para uma subpasta.');
  const affected = folders.filter((f) => subtree.has(f.id));
  if (affected.some((f) => f.special_use)) throw Error('Pastas especiais não podem ser alteradas.');
  const parentChanged = target.parent_id !== source.parent_id;
  if (
    affected.some((f) => f.is_local !== source.is_local) ||
    (parentChanged && parent && parent.is_local !== source.is_local)
  )
    throw Error('Pastas locais e pastas do servidor não podem ser combinadas.');
  const delimiter = source.delimiter ?? '/';
  if (!source.is_local && parent && (parent.delimiter ?? '/') !== delimiter)
    throw Error('O destino usa um separador de pastas incompatível.');
  const name = target.name.trim();
  if (!name || name.length > 100 || /[\r\n\0/\\]/.test(name) || name.includes(delimiter))
    throw Error('Use um nome de pasta sem separadores ou quebras de linha.');
  // Imports can attach local content to remote Inbox/Sent while storing its path in
  // local/folders/{parent-id}. A rename must retain that existing virtual namespace.
  const path =
    source.is_local && !parentChanged
      ? source.imap_path.slice(0, source.imap_path.lastIndexOf(delimiter) + delimiter.length) + name
      : parent
        ? parent.imap_path + delimiter + name
        : name;
  const updates = affected.map((f) => {
    if (f.id !== source.id && !f.imap_path.startsWith(source.imap_path + delimiter))
      throw Error('A hierarquia da pasta mudou. Atualize a lista e tente novamente.');
    return {
      id: f.id,
      name: f.id === source.id ? name : f.name,
      parent_id: f.id === source.id ? target.parent_id : f.parent_id,
      imap_path: path + f.imap_path.slice(source.imap_path.length),
    };
  });
  const paths = new Set(updates.map((f) => f.imap_path));
  if (
    paths.size !== updates.length ||
    folders.some((f) => !subtree.has(f.id) && paths.has(f.imap_path))
  )
    throw Error('Já existe uma pasta com este nome no destino.');
  return updates;
}
