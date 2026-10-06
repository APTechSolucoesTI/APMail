import type { ImapFlow, ImapResponse, ImapAttribute } from 'imapflow';

type Quota = { root: string; used: string; limit: string };
type Handlers = { untagged: Record<string, (response: ImapResponse) => Promise<void>> };
// ImapFlow's public getQuota merges every QUOTA reply. Keep the internal command
// boundary small and covered by a protocol test until it exposes separate roots.
export type QuotaConnection = {
  capabilities: Map<string, unknown>;
  exec: (
    command: string,
    args: { type: 'STRING'; value: string }[],
    options: Handlers,
  ) => Promise<{ next: () => void }>;
};
function token(attribute: ImapAttribute | undefined): string | null {
  const value = attribute?.value;
  return typeof value === 'string' ? value : Buffer.isBuffer(value) ? value.toString() : null;
}
function bytes(attribute: ImapAttribute | undefined): string | null {
  const value = token(attribute);
  if (value === null || !/^\d{1,19}$/.test(value)) return null;
  const result = BigInt(value) * 1024n;
  return result <= 9223372036854775807n ? result.toString() : null;
}
export function isAccountQuotaRoot(root: string, username: string, host: string): boolean {
  const name = root.trim().toLowerCase();
  const user = username.toLowerCase();
  if (name === user || name === `#user/${user}` || name === `user/${user}`) return true;
  const domain = user.includes('@') ? user.split('@').at(-1) : null;
  if (
    name === domain ||
    /(?:^|[^a-z])(domain|dominio|global|server|tenant|shared|company|hosting)(?:$|[^a-z])/.test(
      name,
    )
  )
    return false;
  if (/^(?:user|mailbox|personal)(?:[ _-]+quota)?$/.test(name)) return true;
  // An opaque root has no standardized scope. The empty root is account-scoped
  // on these known services; do not guess for other hosting providers.
  return name === '' && ['imap.gmail.com', 'outlook.office365.com'].includes(host.toLowerCase());
}
export async function readAccountQuota(
  imap: ImapFlow | QuotaConnection,
  username: string,
  host: string,
): Promise<Quota | null> {
  if (!imap.capabilities.has('QUOTA')) return null;
  const connection = imap as unknown as QuotaConnection;
  if (typeof connection.exec !== 'function') throw Error('IMAP quota command unavailable');
  const roots = new Set<string>(),
    values = new Map<string, Quota>();
  const collect = async (response: ImapResponse) => {
    const root = token(response.attributes?.[0]),
      resources = response.attributes?.[1];
    if (root === null || !Array.isArray(resources)) return;
    for (let i = 0; i + 2 < resources.length; i += 3) {
      if (token(resources[i])?.toUpperCase() !== 'STORAGE') continue;
      const used = bytes(resources[i + 1]),
        limit = bytes(resources[i + 2]);
      if (used !== null && limit !== null) values.set(root, { root, used, limit });
    }
  };
  const response = await connection.exec('GETQUOTAROOT', [{ type: 'STRING', value: 'INBOX' }], {
    untagged: {
      QUOTAROOT: async (reply) => {
        if (token(reply.attributes?.[0])?.toUpperCase() !== 'INBOX') return;
        for (const attribute of reply.attributes?.slice(1) ?? []) {
          const root = token(attribute);
          if (root !== null) roots.add(root);
        }
      },
      QUOTA: collect,
    },
  });
  response.next();
  const candidates = [...roots].filter((root) => isAccountQuotaRoot(root, username, host));
  if (candidates.length !== 1) return null;
  const root = candidates[0]!;
  if (!values.has(root)) {
    const reply = await connection.exec('GETQUOTA', [{ type: 'STRING', value: root }], {
      untagged: { QUOTA: collect },
    });
    reply.next();
  }
  return values.get(root) ?? null;
}
