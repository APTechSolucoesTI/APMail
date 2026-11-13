import { api, ApiError } from './api';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const mailboxPath = new RegExp('^/mail/' + uuid + '$', 'i');
const messageLink = new RegExp('^web\\+apmail://mensagem/(' + uuid + ')$', 'i');
const maxPathLength = 2048;
const maxLinkLength = 12 * maxPathLength + 100;
const unsafePath = /[\\\s\p{Cc}\p{Cf}#]|[a-z][a-z\d+.-]*:/iu;
const pendingKey = 'apmail:external-launch';

type ExternalLaunch = { kind: 'path'; path: string } | { kind: 'message'; id: string };

export function validateExternalPath(path: string, origin: string): string | null {
  if (path.length > maxPathLength || !path.startsWith('/') || path.startsWith('//')) return null;
  const pathname = path.split('?')[0];
  if (pathname !== '/' && pathname !== '/invitations' && !mailboxPath.test(pathname!)) return null;

  // Check encoded layers as well as the original string before URL normalization.
  try {
    let decoded = path;
    for (let layer = 0; layer < 5; layer++) {
      if (unsafePath.test(decoded)) return null;
      if (!decoded.includes('%')) {
        const url = new URL(path, origin);
        return url.origin === origin && url.pathname === pathname ? path : null;
      }
      decoded = decodeURIComponent(decoded);
    }
  } catch {
    return null;
  }
  return null;
}

export function parseExternalLaunch(link: string, origin: string): ExternalLaunch | null {
  if (link.length > maxLinkLength || /[\\\s\p{Cc}\p{Cf}#]/u.test(link)) return null;
  const message = messageLink.exec(link);
  if (message) return { kind: 'message', id: message[1]!.toLowerCase() };

  const pathParam = /^web\+apmail:\/\/abrir\/?\?caminho=([^&]+)$/i.exec(link);
  if (!pathParam) return null;
  try {
    const path = validateExternalPath(decodeURIComponent(pathParam[1]!), origin);
    return path ? { kind: 'path', path } : null;
  } catch {
    return null;
  }
}

export function readExternalLaunch(search: string, origin: string): ExternalLaunch | null {
  const links = new URLSearchParams(search).getAll('u');
  return links.length === 1 ? parseExternalLaunch(links[0]!, origin) : null;
}

export function saveExternalLaunch(destination: ExternalLaunch) {
  const link =
    destination.kind === 'path'
      ? 'web+apmail://abrir?caminho=' + encodeURIComponent(destination.path)
      : 'web+apmail://mensagem/' + destination.id;
  try {
    window.sessionStorage.setItem(pendingKey, link);
  } catch {
    // A browser that blocks storage can still sign in normally.
  }
}

export function takeExternalLaunch(origin: string): ExternalLaunch | null {
  try {
    const link = window.sessionStorage.getItem(pendingKey);
    window.sessionStorage.removeItem(pendingKey);
    return link ? parseExternalLaunch(link, origin) : null;
  } catch {
    return null;
  }
}

export async function resolveExternalLaunch(
  destination: ExternalLaunch | null,
  origin: string,
  messagePath = async (id: string) =>
    (await api<{ path: string }>('/messages/' + id + '/location')).path,
): Promise<string> {
  if (!destination) return '/';
  try {
    const path = destination.kind === 'path' ? destination.path : await messagePath(destination.id);
    return validateExternalPath(path, origin) ?? '/';
  } catch (error) {
    if (error instanceof ApiError && [403, 404, 409].includes(error.status)) return '/';
    throw error;
  }
}
