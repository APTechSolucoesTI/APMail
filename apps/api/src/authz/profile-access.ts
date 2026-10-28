import type { FastifyInstance } from 'fastify';
import { hasAccess, type AccessPermission } from '@apmail/shared';
import { forbidden } from './context.js';

/** Explicit module boundary for custom profiles; unknown operational endpoints fail closed. */
export function routePermission(
  path: string,
  method: string,
): AccessPermission | 'personal' | null {
  if (/^\/api\/security\/antivirus(?:\/|$)/.test(path)) {
    if (method !== 'GET' && /\/rules(?:\/|$)/.test(path)) return 'antivirus.trust';
    if (method !== 'GET' && /\/releases(?:\/|$)/.test(path)) return 'antivirus.release';
    return 'antivirus.view';
  }
  if (
    /^\/api\/(auth(?:\/|$)|preferences(?:\/|$)|avatars(?:\/|$)|notifications(?:\/|$)|presence(?:\/|$)|health$)/.test(
      path,
    )
  )
    return 'personal';
  if (/^\/api\/(tenants(?:\/|$)|tenant(?:\/|$))/.test(path))
    return method === 'GET' ? 'personal' : 'company.manage';
  if (/^\/api\/members\/directory$/.test(path)) return 'personal';
  if (/^\/api\/members\/[^/]+\/permissions$/.test(path)) return 'users.manage';
  if (/^\/api\/access-profiles(?:\/|$)/.test(path))
    return method === 'GET' ? 'personal' : 'profiles.manage';
  if (/^\/api\/invitations(?:\/|$)/.test(path)) return 'users.invite';
  if (/^\/api\/members(?:\/|$)/.test(path)) return method === 'GET' ? 'users.view' : 'users.manage';
  if (/^\/api\/audit-logs(?:\/|$)/.test(path)) return 'audit.view';
  if (
    /^\/api\/(calendar|calendars)(?:\/|$)/.test(path) ||
    /^\/api\/messages\/[^/]+\/calendar/.test(path)
  )
    return 'calendar';
  if (/^\/api\/reminders(?:\/|$)/.test(path)) return 'reminders';
  if (/^\/api\/(integrations|google)(?:\/|$)/.test(path)) return 'integrations';
  if (
    /^\/api\/(contacts|contact-emails|companies|contact-imports|contact-directory|contact-resolution)(?:\/|$)/.test(
      path,
    )
  )
    return method === 'GET' || /\/(resolve|lookup)(?:\/|$)/.test(path)
      ? 'contacts'
      : method === 'DELETE'
        ? 'contacts.delete'
        : method === 'PUT' || method === 'PATCH' || /\/[^/]+\/emails$/.test(path)
          ? 'contacts.edit'
          : 'contacts.create';
  if (/^\/api\/(chat|chats)(?:\/|$)/.test(path)) return 'chat';
  if (/^\/api\/(reports|dashboard)(?:\/|$)/.test(path)) return 'reports';
  if (/^\/api\/(signatures)(?:\/|$)/.test(path)) return 'signatures';
  if (/^\/api\/(labels|personal-labels)(?:\/|$)/.test(path)) return 'labels';
  if (/^\/api\/(rules)(?:\/|$)/.test(path) || /\/rules(?:\/|$)/.test(path)) return 'rules';
  if (/^\/api\/(mail-archives|pst-exports|mail-archive-exports)(?:\/|$)/.test(path))
    return 'archives';
  if (/^\/api\/(recurring-schedules|schedules)(?:\/|$)/.test(path)) return 'schedules';
  // Detail authorizes the actual persisted status: private drafts belong to Mail, not Envios.
  if (/^\/api\/outbox\/[^/]+$/.test(path) && method === 'GET') return 'personal';
  if (/^\/api\/outbox(?:\/|$)/.test(path)) return method === 'GET' ? 'schedules' : 'mail.send';
  if (/^\/api\/(uploads|address-suggestions)(?:\/|$)/.test(path)) return 'mail.send';
  if (/^\/api\/mailboxes(?:\/|$)/.test(path)) {
    if (/\/archive-(?:imports|exports|export|purge-deleted)(?:\/|$)/.test(path)) return 'archives';
    if (/\/messages\/actions$/.test(path) || (/\/folders\/[^/]+$/.test(path) && method !== 'GET'))
      return 'mail.organize';
    if (/\/folders$/.test(path) && method !== 'GET') return 'mail.organize';
    if (
      method !== 'GET' &&
      /^\/api\/mailboxes(?:\/[^/]+(?:\/(?:credentials|test|sync|members)(?:\/[^/]+)?)?)?$/.test(
        path,
      )
    )
      return 'mailboxes.manage';
    return 'mail';
  }
  if (/^\/api\/(threads|messages|attachments|search|global-search|mail-summary)(?:\/|$)/.test(path))
    return 'mail';
  if (/^\/api\/me(?:\/|$)/.test(path)) return 'personal';
  if (/^\/api\/public\//.test(path)) return 'personal';
  if (/^\/api\/notes(?:\/|$)/.test(path)) return 'mail';
  if (/^\/api\/mailbox-deletions(?:\/|$)/.test(path)) return 'mailboxes.manage';
  if (/^\/api\/folders(?:\/|$)/.test(path)) return method === 'GET' ? 'mail' : 'mail.organize';
  if (/^\/api\/storage(?:\/|$)/.test(path)) return 'company.manage';
  return null;
}
export function installProfileAccess(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    const c = req.ctx;
    if (!(c?.accessRestricted ?? !!c?.accessProfileId) || !c.tenantId || c.platformAdmin) return;
    const permission = routePermission(req.url.split('?')[0]!, req.method);
    if (permission === 'personal') return;
    if (
      !permission ||
      !hasAccess({ role: c.tenantRole, access_permissions: c.accessPermissions }, permission)
    )
      throw forbidden();
  });
}
